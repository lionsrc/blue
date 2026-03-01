import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Bindings } from '../types.js';
import { authenticateAdmin } from '../auth.js';

const admin = new Hono<{ Bindings: Bindings }>();

admin.get('/api/admin/session', authenticateAdmin, async (c: any) => {
    return c.json({ admin: c.get('admin') });
});

admin.get('/api/admin/users', authenticateAdmin, async (c: any) => {
    const { results: users } = await c.env.DB.prepare(
        `SELECT u.id, u.email, u.tier, u.subscriptionPlan, u.bandwidthLimitMbps, u.creditBalance, u.isActive, u.createdAt,
				u.totalBytesUsed, u.lastConnectTime, u.lastConnectIp, u.lastClientSoftware,
		        a.nodeId, a.port
		 FROM Users u
		 LEFT JOIN UserAllocations a ON u.id = a.userId
		 ORDER BY u.createdAt DESC`
    ).all();

    return c.json({ users });
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
    const { block } = await c.req.json(); // boolean: true to block, false to unblock

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
		        COUNT(a.id) as allocationCount
		 FROM Nodes n
		 LEFT JOIN UserAllocations a ON n.id = a.nodeId
		 GROUP BY n.id
		 ORDER BY n.createdAt DESC`
    ).all();

    return c.json({ nodes });
});

admin.post('/api/admin/nodes', authenticateAdmin, async (c: any) => {
    const { name, publicIp } = await c.req.json();
    if (!name || !publicIp) return c.json({ error: "Name and Public IP required" }, 400);

    const nodeId = uuidv4();
    try {
        await c.env.DB.prepare(
            `INSERT INTO Nodes (id, name, publicIp, status) VALUES (?, ?, ?, 'provisioning')`
        ).bind(nodeId, name, publicIp).run();

        return c.json({ message: "Node registered successfully", nodeId, status: 'provisioning' });
    } catch (error) {
        return c.json({ error: "Node IP already exists or database error" }, 500);
    }
});

export default admin;
