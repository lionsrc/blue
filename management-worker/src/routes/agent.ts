import { Hono } from 'hono';
import type { Bindings } from '../types.js';
import { requireSecret, readAgentSyncPayload } from '../auth.js';
import {
    resolvePlanId, getPlanDefinition, getCurrentPeriodBytesUsed,
    isQuotaExceeded, normalizeUsageBytes, getUsagePeriodStart,
    bytesToGb,
} from '../plans.js';

const agent = new Hono<{ Bindings: Bindings }>();

// --- Node Polling Agent API ---
const handleAgentConfigSync = async (c: any) => {
    const nodeIp = c.req.header('X-Node-IP');
    const agentSecret = c.req.header('X-Agent-Secret');

    try {
        if (agentSecret !== requireSecret(c, 'AGENT_SECRET')) {
            return c.json({ error: 'Unauthorized agent' }, 401);
        }
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Missing required secret:')) {
            return c.json({ error: err.message }, 500);
        }
        throw err;
    }

    const node = await c.env.DB.prepare(`SELECT id FROM Nodes WHERE publicIp = ?`).bind(nodeIp).first();
    if (!node) return c.json({ error: 'Node not found in registry' }, 404);

    const syncPayload = await readAgentSyncPayload(c);

    // Update ping and the latest health metrics we have for the node.
    await c.env.DB.prepare(
        `UPDATE Nodes
		 SET lastPing = CURRENT_TIMESTAMP,
		     cpuLoad = COALESCE(?, cpuLoad),
		     activeConnections = COALESCE(?, activeConnections),
		     status = 'active'
		 WHERE id = ?`
    ).bind(syncPayload.cpuLoad, syncPayload.activeConnections, node.id).run();

    // Fetch all user allocations for this node to construct the `tc` and Xray payload
    const { results: allocations } = await c.env.DB.prepare(
        `SELECT a.userId, a.xrayUuid, a.port, a.speedLimitMbps, u.email, u.tier, u.subscriptionPlan, u.bandwidthLimitMbps,
		        u.currentUsagePeriodStart, u.currentPeriodBytesUsed
		 FROM UserAllocations a
		 JOIN Users u ON u.id = a.userId
		 WHERE a.nodeId = ?
		 ORDER BY a.createdAt ASC`
    ).bind(node.id).all();

    const nodeConfig = allocations.flatMap((allocation: any) => {
        const planId = resolvePlanId(allocation.subscriptionPlan, allocation.tier);
        const activePlan = getPlanDefinition(planId);
        const currentPeriodBytesUsed = getCurrentPeriodBytesUsed(
            allocation.currentUsagePeriodStart,
            allocation.currentPeriodBytesUsed,
        );

        if (isQuotaExceeded(planId, currentPeriodBytesUsed)) {
            return [];
        }

        return [{
            userId: allocation.userId,
            email: allocation.email,
            tier: planId,
            subscriptionPlan: planId,
            xrayUuid: allocation.xrayUuid,
            port: allocation.port,
            speedLimitMbps: activePlan.bandwidthLimitMbps,
            monthlyTrafficLimitGb: activePlan.monthlyTrafficLimitGb,
            deviceLimit: activePlan.deviceLimit,
        }];
    });

    return c.json({ node_config: nodeConfig });
};

agent.get('/api/agent/config', handleAgentConfigSync);
agent.post('/api/agent/config', handleAgentConfigSync);

agent.post('/api/usage/report', async (c: any) => {
    try {
        if (c.req.header('X-Usage-Secret') !== requireSecret(c, 'USAGE_REPORT_SECRET')) {
            return c.json({ error: 'Unauthorized usage reporter' }, 401);
        }
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Missing required secret:')) {
            return c.json({ error: err.message }, 500);
        }
        throw err;
    }

    let body: { userId?: unknown; bytesUsed?: unknown };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (typeof body.userId !== 'string' || !body.userId) {
        return c.json({ error: 'Missing userId' }, 400);
    }

    const bytesUsed = normalizeUsageBytes(body.bytesUsed);
    if (bytesUsed <= 0) {
        return c.json({ error: 'Invalid bytesUsed value' }, 400);
    }

    const userRecord = await c.env.DB.prepare(
        `SELECT id, tier, subscriptionPlan, totalBytesUsed, currentUsagePeriodStart, currentPeriodBytesUsed
		 FROM Users WHERE id = ?`
    ).bind(body.userId).first();
    if (!userRecord) {
        return c.json({ error: 'User not found' }, 404);
    }

    const planId = resolvePlanId(userRecord.subscriptionPlan, userRecord.tier);
    const usagePeriodStart = getUsagePeriodStart();
    const currentPeriodBytes = getCurrentPeriodBytesUsed(
        userRecord.currentUsagePeriodStart,
        userRecord.currentPeriodBytesUsed,
    );

    const nextCurrentPeriodBytesUsed = currentPeriodBytes + bytesUsed;
    const nextTotalBytesUsed = normalizeUsageBytes(userRecord.totalBytesUsed) + bytesUsed;

    await c.env.DB.prepare(
        `UPDATE Users
		 SET totalBytesUsed = ?,
		     currentUsagePeriodStart = ?,
		     currentPeriodBytesUsed = ?
		 WHERE id = ?`
    ).bind(nextTotalBytesUsed, usagePeriodStart, nextCurrentPeriodBytesUsed, body.userId).run();

    return c.json({
        success: true,
        userId: body.userId,
        currentPeriodBytesUsed: nextCurrentPeriodBytesUsed,
        currentPeriodUsageGb: bytesToGb(nextCurrentPeriodBytesUsed),
        quotaExceeded: isQuotaExceeded(planId, nextCurrentPeriodBytesUsed),
    });
});

// --- Cron Trigger: Health Monitor & Failover ---
export async function runHealthCheck(env: any) {
    const activeDomain = await env.DB.prepare(`SELECT id, domainName FROM Domains WHERE status = 'active' LIMIT 1`).first();
    if (!activeDomain) return;

    try {
        const start = Date.now();
        const res = await fetch(`https://${activeDomain.domainName}/health`, {
            method: 'GET',
            headers: { 'X-Health-Check': env.AGENT_SECRET }
        });

        if (res.ok) {
            console.log(`[Health Monitor] Domain ${activeDomain.domainName} is reachable (${Date.now() - start}ms)`);
            return;
        }
        throw new Error(`HTTP ${res.status}`);
    } catch (error) {
        console.error(`[Health Monitor] Domain ${activeDomain.domainName} failed check:`, error);
        await triggerFailover(env, activeDomain);
    }
}

async function triggerFailover(env: any, failedDomain: any) {
    console.log(`[Failover] Initiating failover for blocked domain: ${failedDomain.domainName}`);

    await env.DB.prepare(`UPDATE Domains SET status = 'blocked' WHERE id = ?`).bind(failedDomain.id).run();

    const standbyDomain = await env.DB.prepare(`SELECT id, domainName, cloudflareZoneId FROM Domains WHERE status = 'standby' LIMIT 1`).first();

    if (!standbyDomain) {
        console.error(`[Failover] CRITICAL: No standby domains available!`);
        return;
    }

    await env.DB.prepare(`UPDATE Domains SET status = 'active' WHERE id = ?`).bind(standbyDomain.id).run();
    console.log(`[Failover] Activated standby domain: ${standbyDomain.domainName}`);
}

export default agent;
