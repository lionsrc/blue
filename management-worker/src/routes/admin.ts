import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Bindings } from '../types.js';
import { authenticateAdmin } from '../auth.js';

const admin = new Hono<{ Bindings: Bindings }>();

admin.get('/api/admin/session', authenticateAdmin, async (c: any) => {
    return c.json({ admin: c.get('admin') });
});

admin.get('/api/admin/users', authenticateAdmin, async (c: any) => {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '20', 10)));
    const search = c.req.query('search') || '';
    const tier = c.req.query('tier') || 'all';

    let baseQuery = `FROM Users u LEFT JOIN UserAllocations a ON u.id = a.userId`;
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
               a.nodeId, a.port
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
