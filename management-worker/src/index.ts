import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types.js';
import { getAllowedCorsOrigins } from './auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import agentRoutes, { runHealthCheck } from './routes/agent.js';

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for all routes
app.use('/*', cors({
	origin: (origin: string, c) => {
		const allowedOrigins = getAllowedCorsOrigins(c);
		return allowedOrigins.has(origin) ? origin : '';
	},
	allowHeaders: ['Content-Type', 'Authorization', 'X-Node-IP', 'X-Agent-Secret', 'X-Health-Check', 'X-Usage-Secret'],
	allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
	credentials: true,
}));

// Mount route groups
app.route('/', userRoutes);
app.route('/', adminRoutes);
app.route('/', agentRoutes);

export default {
	fetch: app.fetch,

	async scheduled(event: any, env: any, ctx: any) {
		ctx.waitUntil(runHealthCheck(env));
	},
};
