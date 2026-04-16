import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Bindings } from '../types.js';
import { authenticateAdmin, getAllowedCorsOrigins, hashPassword } from '../auth.js';
import { findAvailableAllocationPort } from '../allocations.js';

const admin = new Hono<{ Bindings: Bindings }>();

const createAgentToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;

const resolveAllowedReturnTo = (c: any) => {
    const returnTo = c.req.query('returnTo');
    if (!returnTo) {
        return null;
    }

    try {
        const url = new URL(returnTo);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return null;
        }

        const allowedOrigins = getAllowedCorsOrigins(c);
        if (!allowedOrigins.has(url.origin)) {
            return null;
        }

        return url.toString();
    } catch {
        return null;
    }
};

admin.get('/api/admin/session', authenticateAdmin, async (c: any) => {
    if (c.req.query('returnTo') !== undefined) {
        const returnTo = resolveAllowedReturnTo(c);
        if (!returnTo) {
            return c.json({ error: 'Invalid returnTo URL' }, 400);
        }

        return c.redirect(returnTo, 302);
    }

    return c.json({ admin: c.get('admin') });
});

admin.get('/api/admin/users', authenticateAdmin, async (c: any) => {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '20', 10)));
    const search = c.req.query('search') || '';
    const tier = c.req.query('tier') || 'all';

    let baseQuery = `FROM Users u LEFT JOIN UserAllocations a ON u.id = a.userId LEFT JOIN Nodes n ON a.nodeId = n.id`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (search.trim()) {
        conditions.push(`u.email LIKE ?`);
        params.push(`%${search.trim()}%`);
    }

    if (tier !== 'all') {
        conditions.push(`u.tier = ?`);
        params.push(tier);
    }

    if (conditions.length > 0) {
        baseQuery += ` WHERE ` + conditions.join(' AND ');
    }

    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
    const totalResult = await c.env.DB.prepare(countQuery).bind(...params).first();
    const total = totalResult?.total || 0;

    const offset = (page - 1) * limit;

    const dataQuery = `
        SELECT u.id, u.email, u.tier, u.subscriptionPlan, u.bandwidthLimitMbps, u.creditBalance, u.isActive, u.createdAt,
               u.totalBytesUsed, u.lastConnectTime, u.lastConnectIp, u.lastClientSoftware,
               a.nodeId, a.port, n.name AS nodeName, n.publicIp AS nodePublicIp
        ${baseQuery}
        ORDER BY u.createdAt DESC
        LIMIT ? OFFSET ?
    `;

    const { results: users } = await c.env.DB.prepare(dataQuery).bind(...params, limit, offset).all();

    return c.json({
        users,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
    });
});

admin.post('/api/admin/users/:id/move', authenticateAdmin, async (c: any) => {
    const userId = c.req.param('id');
    let nodeId: string | undefined;

    try {
        ({ nodeId } = JSON.parse(await c.req.text() || '{}'));
    } catch {
        return c.json({ error: 'Invalid JSON payload format' }, 400);
    }

    if (!nodeId) {
        return c.json({ error: 'Destination node required' }, 400);
    }

    const user = await c.env.DB.prepare(`SELECT id, email FROM Users WHERE id = ?`).bind(userId).first() as { id: string; email: string } | null;
    if (!user) {
        return c.json({ error: 'User not found' }, 404);
    }

    const currentAllocation = await c.env.DB.prepare(
        `SELECT a.id, a.nodeId, a.xrayUuid, a.port, a.speedLimitMbps,
                n.name AS currentNodeName, n.publicIp AS currentNodePublicIp
         FROM UserAllocations a
         JOIN Nodes n ON a.nodeId = n.id
         WHERE a.userId = ?
         LIMIT 1`
    ).bind(userId).first() as {
        id: string;
        nodeId: string;
        xrayUuid: string;
        port: number;
        speedLimitMbps: number;
        currentNodeName: string;
        currentNodePublicIp: string;
    } | null;

    if (!currentAllocation) {
        return c.json({ error: 'User has no active node allocation' }, 400);
    }

    if (currentAllocation.nodeId === nodeId) {
        return c.json({ error: 'User is already assigned to that node' }, 400);
    }

    const destinationNode = await c.env.DB.prepare(
        `SELECT id, name, publicIp, status FROM Nodes WHERE id = ?`
    ).bind(nodeId).first() as {
        id: string;
        name: string;
        publicIp: string;
        status: string;
    } | null;

    if (!destinationNode) {
        return c.json({ error: 'Destination node not found' }, 404);
    }

    if (destinationNode.status !== 'active') {
        return c.json({ error: 'Destination node must be active before reassignment' }, 400);
    }

    const nextPort = await findAvailableAllocationPort(c.env.DB, destinationNode.id);
    if (nextPort === null) {
        return c.json({ error: 'No available ports on the destination node.' }, 503);
    }

    await c.env.DB.batch([
        c.env.DB.prepare(
            `UPDATE UserAllocations SET nodeId = ?, port = ? WHERE id = ?`
        ).bind(destinationNode.id, nextPort, currentAllocation.id),
        c.env.DB.prepare(
            `UPDATE Nodes
             SET activeConnections = CASE
                 WHEN activeConnections > 0 THEN activeConnections - 1
                 ELSE 0
             END
             WHERE id = ?`
        ).bind(currentAllocation.nodeId),
        c.env.DB.prepare(
            `UPDATE Nodes SET activeConnections = activeConnections + 1 WHERE id = ?`
        ).bind(destinationNode.id),
    ]);

    return c.json({
        message: `User ${user.email} moved to ${destinationNode.name}`,
        allocation: {
            userId,
            nodeId: destinationNode.id,
            nodeName: destinationNode.name,
            nodePublicIp: destinationNode.publicIp,
            port: nextPort,
            xrayUuid: currentAllocation.xrayUuid,
            speedLimitMbps: currentAllocation.speedLimitMbps,
            previousNodeId: currentAllocation.nodeId,
            previousNodeName: currentAllocation.currentNodeName,
            previousNodePublicIp: currentAllocation.currentNodePublicIp,
        },
    });
});

admin.get('/api/admin/users/:id/payments', authenticateAdmin, async (c: any) => {
    const userId = c.req.param('id');
    const { results: payments } = await c.env.DB.prepare(
        `SELECT id, amount, currency, status, paymentMethod, createdAt 
		 FROM Payments 
		 WHERE userId = ? 
		 ORDER BY createdAt DESC LIMIT 10`
    ).bind(userId).all();
    return c.json({ payments });
});

admin.post('/api/admin/users/:id/block', authenticateAdmin, async (c: any) => {
    const userId = c.req.param('id');
    const { block } = JSON.parse(await c.req.text() || '{}'); // boolean: true to block, false to unblock

    const newIsActive = block ? 0 : 1;

    // Update user status
    await c.env.DB.prepare(`UPDATE Users SET isActive = ? WHERE id = ?`).bind(newIsActive, userId).run();

    // If blocking, also delete their active allocations so they are kicked off the node immediately during the next sync
    if (block) {
        await c.env.DB.prepare(`DELETE FROM UserAllocations WHERE userId = ?`).bind(userId).run();
    }

    return c.json({ message: `User ${userId} isActive updated to ${newIsActive}` });
});

admin.get('/api/admin/nodes', authenticateAdmin, async (c: any) => {
    const { results: nodes } = await c.env.DB.prepare(
        `SELECT n.id, n.name, n.publicIp, n.status, n.activeConnections, n.cpuLoad, n.lastPing,
                n.ipUpdatedAt,
                CASE WHEN n.agentTokenHash IS NOT NULL THEN 1 ELSE 0 END AS agentTokenConfigured,
			        COUNT(a.id) as allocationCount
			 FROM Nodes n
			 LEFT JOIN UserAllocations a ON n.id = a.nodeId
			 GROUP BY n.id
			 ORDER BY n.createdAt DESC`
    ).all();

    return c.json({ nodes });
});

admin.post('/api/admin/nodes', authenticateAdmin, async (c: any) => {
    let name, publicIp;
    try {
        const body = JSON.parse(await c.req.text());
        name = body.name;
        publicIp = body.publicIp;
    } catch {
        return c.json({ error: "Invalid JSON payload format" }, 400);
    }
    if (!name || !publicIp) return c.json({ error: "Name and Public IP required" }, 400);

    const nodeId = uuidv4();
    const agentToken = createAgentToken();
    const agentTokenHash = await hashPassword(agentToken);
    try {
        await c.env.DB.prepare(
            `INSERT INTO Nodes (id, name, publicIp, status, agentTokenHash) VALUES (?, ?, ?, 'provisioning', ?)`
        ).bind(nodeId, name, publicIp, agentTokenHash).run();

        return c.json({
            message: "Node registered successfully",
            nodeId,
            agentToken,
            status: 'provisioning',
        });
    } catch (error) {
        return c.json({ error: "Failed to register node" }, 500);
    }
});

admin.post('/api/admin/nodes/:id/rotate-token', authenticateAdmin, async (c: any) => {
    const nodeId = c.req.param('id');
    const existingNode = await c.env.DB.prepare(
        `SELECT id, name FROM Nodes WHERE id = ?`
    ).bind(nodeId).first() as { id: string; name: string } | null;

    if (!existingNode) {
        return c.json({ error: 'Node not found' }, 404);
    }

    const agentToken = createAgentToken();
    const agentTokenHash = await hashPassword(agentToken);

    await c.env.DB.prepare(
        `UPDATE Nodes SET agentTokenHash = ? WHERE id = ?`
    ).bind(agentTokenHash, nodeId).run();

    return c.json({
        message: `Agent token issued for ${existingNode.name}`,
        nodeId,
        agentToken,
    });
});

admin.get('/api/admin/nodes/:id/ip-history', authenticateAdmin, async (c: any) => {
    const nodeId = c.req.param('id');
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '20', 10)));

    const existingNode = await c.env.DB.prepare(
        `SELECT id, name FROM Nodes WHERE id = ?`
    ).bind(nodeId).first() as { id: string; name: string } | null;

    if (!existingNode) {
        return c.json({ error: 'Node not found' }, 404);
    }

    const { results: history } = await c.env.DB.prepare(
        `SELECT id, previousIp, newIp, changedAt
         FROM NodeIpHistory
         WHERE nodeId = ?
         ORDER BY changedAt DESC
         LIMIT ?`
    ).bind(nodeId, limit).all();

    return c.json({
        nodeId,
        nodeName: existingNode.name,
        history,
    });
});

export default admin;
