import { beforeEach, describe, expect, it } from 'vitest';
import * as jwt from '@tsndr/cloudflare-worker-jwt';
import worker from '../src';
import { _resetRateLimitBucketsForTesting } from '../src/auth';

type UserRow = {
	id: string;
	email: string;
	passwordHash: string;
	tier: string;
	isActive: number;
	bandwidthLimitMbps: number;
	creditBalance: number;
	totalBytesUsed: number;
	currentUsagePeriodStart?: string | null;
	currentPeriodBytesUsed: number;
	subscriptionPlan?: string;
	subscriptionEndDate?: string | null;
};

type NodeRow = {
	id: string;
	name: string;
	publicIp: string;
	status: string;
	activeConnections: number;
	cpuLoad: number;
	lastPing: string | null;
};

type AllocationRow = {
	id: string;
	userId: string;
	nodeId: string;
	xrayUuid: string;
	port: number;
	speedLimitMbps: number;
};

type PaymentRow = {
	id: string;
	userId: string;
	amount: number;
	currency: string;
	status: string;
	paymentMethod: string | null;
	packageId: string;
	createdAt: string;
};

type TestEnv = {
	DB: FakeD1Database;
	JWT_SECRET: string;
	AGENT_SECRET: string;
	SESSION_TOKEN_SECRET: string;
	USAGE_REPORT_SECRET: string;
	CF_ACCESS_TEAM_DOMAIN: string;
	CF_ACCESS_AUD: string;
};

class FakeD1Statement {
	private args: unknown[] = [];

	constructor(
		private readonly db: FakeD1Database,
		private readonly sql: string,
	) { }

	bind(...args: unknown[]) {
		this.args = args;
		return this;
	}

	async first<T>() {
		return this.db.first<T>(this.sql, this.args);
	}

	async run() {
		return this.db.run(this.sql, this.args);
	}

	async all<T>() {
		return this.db.all<T>(this.sql, this.args);
	}
}

class FakeD1Database {
	users = new Map<string, UserRow>();
	nodes = new Map<string, NodeRow>();
	allocations: AllocationRow[] = [];
	payments: PaymentRow[] = [];

	prepare(sql: string) {
		return new FakeD1Statement(this, sql);
	}

	async batch(statements: FakeD1Statement[]) {
		for (const statement of statements) {
			await statement.run();
		}
		return [];
	}

	async first<T>(sql: string, args: unknown[]) {
		if (sql.includes('FROM Users WHERE email = ?')) {
			const email = String(args[0]);
			for (const user of this.users.values()) {
				if (user.email === email) {
					return { ...user } as T;
				}
			}
			return null;
		}

		if (sql.includes('SELECT id, tier, isActive FROM Users WHERE id = ?')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return {
				id: user.id,
				tier: user.tier,
				isActive: user.isActive,
			} as T;
		}

		if (sql.includes('SELECT id, tier, subscriptionPlan, bandwidthLimitMbps') && sql.includes('FROM Users WHERE id = ?')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return {
				id: user.id,
				tier: user.tier,
				subscriptionPlan: user.subscriptionPlan ?? user.tier,
				bandwidthLimitMbps: user.bandwidthLimitMbps,
				currentUsagePeriodStart: user.currentUsagePeriodStart ?? null,
				currentPeriodBytesUsed: user.currentPeriodBytesUsed,
				isActive: user.isActive,
			} as T;
		}

		if (sql.includes('SELECT id, subscriptionEndDate, isActive FROM Users WHERE id = ?')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return {
				id: user.id,
				subscriptionEndDate: user.subscriptionEndDate ?? null,
				isActive: user.isActive,
			} as T;
		}

		if (sql.includes('SELECT id, email, tier, subscriptionPlan, bandwidthLimitMbps, creditBalance, isActive, subscriptionEndDate')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return {
				id: user.id,
				email: user.email,
				tier: user.tier,
				subscriptionPlan: user.subscriptionPlan ?? user.tier,
				bandwidthLimitMbps: user.bandwidthLimitMbps,
				creditBalance: user.creditBalance,
				isActive: user.isActive,
				subscriptionEndDate: user.subscriptionEndDate ?? null,
				currentUsagePeriodStart: user.currentUsagePeriodStart ?? null,
				currentPeriodBytesUsed: user.currentPeriodBytesUsed,
			} as T;
		}

		if (sql.includes('SELECT id, tier, subscriptionPlan, totalBytesUsed, currentUsagePeriodStart, currentPeriodBytesUsed')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return {
				id: user.id,
				tier: user.tier,
				subscriptionPlan: user.subscriptionPlan ?? user.tier,
				totalBytesUsed: user.totalBytesUsed,
				currentUsagePeriodStart: user.currentUsagePeriodStart ?? null,
				currentPeriodBytesUsed: user.currentPeriodBytesUsed,
			} as T;
		}

		if (sql.includes('SELECT id FROM Nodes WHERE publicIp = ?')) {
			const publicIp = String(args[0]);
			for (const node of this.nodes.values()) {
				if (node.publicIp === publicIp) {
					return { id: node.id } as T;
				}
			}
			return null;
		}

		if (sql.includes('SELECT id, tier, subscriptionPlan, subscriptionEndDate, bandwidthLimitMbps, isActive, currentUsagePeriodStart, currentPeriodBytesUsed')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return {
				id: user.id,
				tier: user.tier,
				subscriptionPlan: user.subscriptionPlan ?? user.tier,
				subscriptionEndDate: user.subscriptionEndDate ?? null,
				bandwidthLimitMbps: user.bandwidthLimitMbps,
				isActive: user.isActive,
				currentUsagePeriodStart: user.currentUsagePeriodStart ?? null,
				currentPeriodBytesUsed: user.currentPeriodBytesUsed,
			} as T;
		}

		if (sql.includes('SELECT passwordHash FROM Users WHERE id = ?')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return { passwordHash: user.passwordHash } as T;
		}

		throw new Error(`Unhandled first() SQL: ${sql}`);
	}

	async run(sql: string, args: unknown[]) {
		if (sql.includes('INSERT INTO Users')) {
			const [id, email, passwordHash] = args as [string, string, string];
			if (Array.from(this.users.values()).some((user) => user.email === email)) {
				throw new Error('Duplicate user');
			}
			this.users.set(id, {
				id,
				email,
				passwordHash,
				tier: 'free',
				isActive: 1,
				bandwidthLimitMbps: 1,
				creditBalance: 0,
				totalBytesUsed: 0,
				currentUsagePeriodStart: null,
				currentPeriodBytesUsed: 0,
				subscriptionPlan: 'free',
				subscriptionEndDate: null,
			});
			return { success: true };
		}

		if (sql.includes('UPDATE Users SET passwordHash = ? WHERE id = ?')) {
			const [passwordHash, userId] = args as [string, string];
			const user = this.users.get(userId);
			if (!user) throw new Error('User not found');
			user.passwordHash = passwordHash;
			return { success: true };
		}

		if (sql.includes('UPDATE Nodes') && sql.includes('lastPing = CURRENT_TIMESTAMP')) {
			const [cpuLoad, activeConnections, nodeId] = args as [number | null, number | null, string];
			const node = this.nodes.get(nodeId);
			if (!node) throw new Error('Node not found');
			if (cpuLoad !== null) node.cpuLoad = cpuLoad;
			if (activeConnections !== null) node.activeConnections = activeConnections;
			node.status = 'active';
			node.lastPing = new Date().toISOString();
			return { success: true };
		}

		if (sql.includes('INSERT INTO Payments')) {
			const [id, userId, amount, currency, paymentMethod, packageId] = args as [string, string, number, string, string | null, string];
			this.payments.push({
				id,
				userId,
				amount,
				currency,
				status: 'completed',
				paymentMethod,
				packageId,
				createdAt: new Date().toISOString(),
			});
			return { success: true };
		}

		if (sql.includes('UPDATE Users') && sql.includes('subscriptionPlan = ?')) {
			const [tier, subscriptionPlan, bandwidthLimitMbps, subscriptionEndDate, userId] = args as [string, string, number, string | null, string];
			const user = this.users.get(userId);
			if (!user) throw new Error('User not found');
			user.tier = tier;
			user.subscriptionPlan = subscriptionPlan;
			user.bandwidthLimitMbps = bandwidthLimitMbps;
			user.subscriptionEndDate = subscriptionEndDate;
			return { success: true };
		}

		if (sql.includes('UPDATE UserAllocations SET speedLimitMbps = ? WHERE userId = ?')) {
			const [speedLimitMbps, userId] = args as [number, string];
			this.allocations = this.allocations.map((allocation) => (
				allocation.userId === userId
					? { ...allocation, speedLimitMbps }
					: allocation
			));
			return { success: true };
		}

		if (sql.includes('UPDATE Users') && sql.includes('currentUsagePeriodStart = ?')) {
			const [totalBytesUsed, currentUsagePeriodStart, currentPeriodBytesUsed, userId] = args as [number, string, number, string];
			const user = this.users.get(userId);
			if (!user) throw new Error('User not found');
			user.totalBytesUsed = totalBytesUsed;
			user.currentUsagePeriodStart = currentUsagePeriodStart;
			user.currentPeriodBytesUsed = currentPeriodBytesUsed;
			return { success: true };
		}

		if (sql.includes('UPDATE Users SET email = ? WHERE id = ?')) {
			const [email, userId] = args as [string, string];
			const user = this.users.get(userId);
			if (!user) throw new Error('User not found');
			// Check for UNIQUE email constraint
			for (const u of this.users.values()) {
				if (u.email === email && u.id !== userId) throw new Error('UNIQUE constraint failed');
			}
			user.email = email;
			return { success: true };
		}

		if (sql.includes('DELETE FROM UserAllocations WHERE userId = ?')) {
			const userId = String(args[0]);
			this.allocations = this.allocations.filter((a) => a.userId !== userId);
			return { success: true };
		}

		if (sql.includes('DELETE FROM Payments WHERE userId = ?')) {
			const userId = String(args[0]);
			this.payments = this.payments.filter((p) => p.userId !== userId);
			return { success: true };
		}

		if (sql.includes('DELETE FROM Users WHERE id = ?')) {
			const userId = String(args[0]);
			this.users.delete(userId);
			return { success: true };
		}

		throw new Error(`Unhandled run() SQL: ${sql}`);
	}

	async all<T>(sql: string, args: unknown[]) {
		if (sql.includes('FROM UserAllocations a') && sql.includes('JOIN Users u')) {
			const nodeId = String(args[0]);
			return {
				results: this.allocations
					.filter((allocation) => allocation.nodeId === nodeId)
					.map((allocation) => {
						const user = this.users.get(allocation.userId);
						if (!user) {
							throw new Error(`Missing user for allocation ${allocation.id}`);
						}

						return {
							...allocation,
							email: user.email,
							tier: user.tier,
							subscriptionPlan: user.subscriptionPlan ?? user.tier,
							bandwidthLimitMbps: user.bandwidthLimitMbps,
							currentUsagePeriodStart: user.currentUsagePeriodStart ?? null,
							currentPeriodBytesUsed: user.currentPeriodBytesUsed,
						};
					}),
			} as { results: T[] };
		}

		if (sql.includes('SELECT port FROM UserAllocations WHERE nodeId = ?')) {
			const nodeId = String(args[0]);
			return {
				results: this.allocations
					.filter((allocation) => allocation.nodeId === nodeId)
					.map((allocation) => ({ port: allocation.port })),
			} as { results: T[] };
		}

		if (sql.includes('FROM UserAllocations WHERE nodeId = ?')) {
			const nodeId = String(args[0]);
			return {
				results: this.allocations
					.filter((allocation) => allocation.nodeId === nodeId)
					.map((allocation) => ({ ...allocation })),
			} as { results: T[] };
		}

		if (sql.includes('FROM Payments WHERE userId = ?')) {
			const userId = String(args[0]);
			return {
				results: this.payments
					.filter((p) => p.userId === userId)
					.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
			} as { results: T[] };
		}

		throw new Error(`Unhandled all() SQL: ${sql}`);
	}
}

const createExecutionContext = () => ({
	waitUntil: () => undefined,
	passThroughOnException: () => undefined,
}) as ExecutionContext;

const createEnv = () => {
	const DB = new FakeD1Database();

	return {
		DB,
		JWT_SECRET: 'test-jwt-secret',
		AGENT_SECRET: 'test-agent-secret',
		SESSION_TOKEN_SECRET: 'test-session-secret',
		USAGE_REPORT_SECRET: 'test-usage-secret',
		CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
		CF_ACCESS_AUD: 'access-audience',
	} satisfies TestEnv;
};

describe('management worker API', () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createEnv();
		_resetRateLimitBucketsForTesting();
	});

	const signupAndLogin = async (testEnv: TestEnv, email: string, password: string) => {
		const signupRes = await worker.fetch(
			new Request('http://example.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			}),
			testEnv as never,
			createExecutionContext(),
		);
		const signupData = await signupRes.json() as { userId: string };
		const userId = signupData.userId;

		const loginRes = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			}),
			testEnv as never,
			createExecutionContext(),
		);
		const loginData = await loginRes.json() as { accessToken: string };
		return { accessToken: loginData.accessToken, userId };
	};

	it('hashes passwords on signup', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'alice@example.com',
					password: 'super-secret',
				}),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const storedUser = Array.from(env.DB.users.values())[0];
		expect(storedUser.email).toBe('alice@example.com');
		expect(storedUser.passwordHash).toMatch(/^pbkdf2:/);
		expect(storedUser.passwordHash).not.toBe('super-secret');
	});

	it('migrates legacy sha256 passwords to pbkdf2 on login', async () => {
		// Pre-hash a password using the legacy sha256 scheme to seed the DB
		const legacySalt = 'deadbeef';
		const legacyData = new TextEncoder().encode(`${legacySalt}:legacy-pass`);
		const legacyDigest = await crypto.subtle.digest('SHA-256', legacyData);
		const legacyHex = Array.from(new Uint8Array(legacyDigest)).map((b) => b.toString(16).padStart(2, '0')).join('');
		const legacyHash = `sha256:${legacySalt}:${legacyHex}`;

		env.DB.users.set('user-1', {
			id: 'user-1',
			email: 'legacy@example.com',
			passwordHash: legacyHash,
			tier: 'free',
			isActive: 1,
			bandwidthLimitMbps: 1,
			creditBalance: 0,
			totalBytesUsed: 0,
			currentUsagePeriodStart: null,
			currentPeriodBytesUsed: 0,
			subscriptionPlan: 'free',
			subscriptionEndDate: null,
		});

		const response = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'legacy@example.com',
					password: 'legacy-pass',
				}),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const data = await response.json() as { accessToken: string };
		expect(data.accessToken).toBeTruthy();
		// After login, the hash should be upgraded to pbkdf2
		expect(env.DB.users.get('user-1')?.passwordHash).toMatch(/^pbkdf2:/);
	});

	it('rejects plaintext passwords that are not hashed', async () => {
		env.DB.users.set('user-plain', {
			id: 'user-plain',
			email: 'plain@example.com',
			passwordHash: 'plaintext-password',
			tier: 'free',
			isActive: 1,
			bandwidthLimitMbps: 1,
			creditBalance: 0,
			totalBytesUsed: 0,
			currentUsagePeriodStart: null,
			currentPeriodBytesUsed: 0,
			subscriptionPlan: 'free',
			subscriptionEndDate: null,
		});

		const response = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'plain@example.com',
					password: 'plaintext-password',
				}),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(401);
	});

	it('issues JWT tokens with an expiry claim', async () => {
		// Signup a user first
		await worker.fetch(
			new Request('http://example.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'exp@example.com', password: 'test-pass-123' }),
			}),
			env as never,
			createExecutionContext(),
		);

		const response = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'exp@example.com', password: 'test-pass-123' }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const data = await response.json() as { accessToken: string };
		const decoded = jwt.decode(data.accessToken);
		const payload = decoded.payload as { exp?: number };
		expect(payload.exp).toBeDefined();
		// Verify expiry is roughly 24 hours from now (within 60s tolerance)
		const expectedExp = Math.floor(Date.now() / 1000) + 86400;
		expect(Math.abs((payload.exp as number) - expectedExp)).toBeLessThan(60);
	});

	it('syncs node config and stores posted health metrics', async () => {
		env.DB.nodes.set('node-1', {
			id: 'node-1',
			name: 'node-1',
			publicIp: '198.51.100.10',
			status: 'provisioning',
			activeConnections: 0,
			cpuLoad: 0,
			lastPing: null,
		});
		env.DB.users.set('user-1', {
			id: 'user-1',
			email: 'node-user@example.com',
			passwordHash: 'sha256:salt:hash',
			tier: 'basic',
			isActive: 1,
			bandwidthLimitMbps: 300,
			creditBalance: 0,
			totalBytesUsed: 0,
			currentUsagePeriodStart: null,
			currentPeriodBytesUsed: 0,
			subscriptionPlan: 'basic',
			subscriptionEndDate: null,
		});
		env.DB.allocations.push({
			id: 'alloc-1',
			userId: 'user-1',
			nodeId: 'node-1',
			xrayUuid: 'uuid-1',
			port: 12001,
			speedLimitMbps: 100,
		});

		const response = await worker.fetch(
			new Request('http://example.com/api/agent/config', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Node-IP': '198.51.100.10',
					'X-Agent-Secret': env.AGENT_SECRET,
				},
				body: JSON.stringify({
					cpuLoad: 1.75,
					activeConnections: 9,
				}),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const data = await response.json() as { node_config: AllocationRow[] };
		expect(data.node_config).toEqual([
			expect.objectContaining({
				email: 'node-user@example.com',
				subscriptionPlan: 'basic',
				xrayUuid: 'uuid-1',
				port: 12001,
				speedLimitMbps: 300,
			}),
		]);

		const node = env.DB.nodes.get('node-1');
		expect(node?.status).toBe('active');
		expect(node?.cpuLoad).toBe(1.75);
		expect(node?.activeConnections).toBe(9);
		expect(node?.lastPing).toBeTruthy();
	});

	it('applies payments to the authenticated user instead of a body-supplied userId', async () => {
		env.DB.users.set('user-a', {
			id: 'user-a',
			email: 'user-a@example.com',
			passwordHash: 'sha256:salt:hash',
			tier: 'free',
			isActive: 1,
			bandwidthLimitMbps: 1,
			creditBalance: 0,
			totalBytesUsed: 0,
			currentUsagePeriodStart: null,
			currentPeriodBytesUsed: 0,
			subscriptionPlan: 'free',
			subscriptionEndDate: null,
		});
		env.DB.users.set('user-b', {
			id: 'user-b',
			email: 'user-b@example.com',
			passwordHash: 'sha256:salt:hash',
			tier: 'free',
			isActive: 1,
			bandwidthLimitMbps: 1,
			creditBalance: 0,
			totalBytesUsed: 0,
			currentUsagePeriodStart: null,
			currentPeriodBytesUsed: 0,
			subscriptionPlan: 'free',
			subscriptionEndDate: null,
		});
		env.DB.allocations.push({
			id: 'alloc-user-a',
			userId: 'user-a',
			nodeId: 'node-1',
			xrayUuid: 'uuid-user-a',
			port: 13001,
			speedLimitMbps: 1,
		});

		const accessToken = await jwt.sign(
			{ id: 'user-a', email: 'user-a@example.com', tier: 'free' },
			env.JWT_SECRET,
		);

		const response = await worker.fetch(
			new Request('http://example.com/api/payments/process', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify({
					userId: 'user-b',
					amount: 18,
					currency: 'USD',
					packageId: 'basic',
				}),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		expect(env.DB.payments).toHaveLength(1);
		expect(env.DB.payments[0].userId).toBe('user-a');
		expect(env.DB.users.get('user-a')?.tier).toBe('basic');
		expect(env.DB.users.get('user-a')?.bandwidthLimitMbps).toBe(300);
		expect(env.DB.allocations.find((allocation) => allocation.userId === 'user-a')?.speedLimitMbps).toBe(300);
		expect(env.DB.users.get('user-b')?.tier).toBe('free');
	});

	it('tracks reported usage and blocks subscriptions after the monthly quota is exceeded', async () => {
		env.DB.users.set('user-free', {
			id: 'user-free',
			email: 'free@example.com',
			passwordHash: 'sha256:salt:hash',
			tier: 'free',
			isActive: 1,
			bandwidthLimitMbps: 1,
			creditBalance: 0,
			totalBytesUsed: 0,
			currentUsagePeriodStart: null,
			currentPeriodBytesUsed: 0,
			subscriptionPlan: 'free',
			subscriptionEndDate: null,
		});

		const usageResponse = await worker.fetch(
			new Request('http://example.com/api/usage/report', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Usage-Secret': env.USAGE_REPORT_SECRET,
				},
				body: JSON.stringify({
					userId: 'user-free',
					bytesUsed: 55 * 1024 * 1024 * 1024,
				}),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(usageResponse.status).toBe(200);
		const usageData = await usageResponse.json() as { quotaExceeded: boolean };
		expect(usageData.quotaExceeded).toBe(true);

		const accessToken = await jwt.sign(
			{ id: 'user-free', email: 'free@example.com', tier: 'free' },
			env.JWT_SECRET,
		);

		const subscriptionResponse = await worker.fetch(
			new Request('http://example.com/api/subscription', {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}),
			env as never,
			createExecutionContext(),
		);

		expect(subscriptionResponse.status).toBe(403);
		expect(await subscriptionResponse.json()).toEqual({
			error: 'Monthly traffic quota exceeded. Upgrade or wait for the next monthly reset.',
		});
	});

	it('requires Cloudflare Access headers for admin session', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/admin/session'),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: 'Cloudflare Access authentication required',
		});
	});

	it('uses PBKDF2 for new signups', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'pbkdf2@example.com', password: 'strong-pass' }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const storedUser = Array.from(env.DB.users.values()).find((u) => u.email === 'pbkdf2@example.com');
		expect(storedUser).toBeDefined();
		expect(storedUser!.passwordHash).toMatch(/^pbkdf2:/);
		expect(storedUser!.passwordHash).not.toBe('strong-pass');

		// Verify login works with the PBKDF2 hash
		const loginResponse = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'pbkdf2@example.com', password: 'strong-pass' }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(loginResponse.status).toBe(200);
		const loginData = await loginResponse.json() as { accessToken: string };
		expect(loginData.accessToken).toBeTruthy();
	});

	it('updates email via PUT /api/change-email', async () => {
		const { accessToken } = await signupAndLogin(env, 'emailtest@example.com', 'strong-pass');

		const response = await worker.fetch(
			new Request('http://example.com/api/change-email', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify({ newEmail: 'new@example.com' }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const data = await response.json() as { email: string };
		expect(data.email).toBe('new@example.com');
	});

	it('updates password via PUT /api/change-password', async () => {
		const { accessToken } = await signupAndLogin(env, 'passtest@example.com', 'old-pass-123');

		const response = await worker.fetch(
			new Request('http://example.com/api/change-password', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify({ currentPassword: 'old-pass-123', newPassword: 'new-pass-456' }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);

		// Verify old password no longer works
		const oldLogin = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'passtest@example.com', password: 'old-pass-123' }),
			}),
			env as never,
			createExecutionContext(),
		);
		expect(oldLogin.status).toBe(401);

		// Verify new password works
		const newLogin = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'passtest@example.com', password: 'new-pass-456' }),
			}),
			env as never,
			createExecutionContext(),
		);
		expect(newLogin.status).toBe(200);
	});

	it('deletes account via DELETE /api/account', async () => {
		const { accessToken, userId } = await signupAndLogin(env, 'delete-me@example.com', 'strong-pass');

		// Seed a payment for this user
		env.DB.payments.push({
			id: 'pay-1', userId, amount: 10, currency: 'USD',
			status: 'completed', paymentMethod: null, packageId: 'basic',
			createdAt: new Date().toISOString(),
		});

		const response = await worker.fetch(
			new Request('http://example.com/api/account', {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${accessToken}` },
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		expect(env.DB.users.has(userId)).toBe(false);
		expect(env.DB.payments.filter((p) => p.userId === userId)).toHaveLength(0);
	});

	it('returns payment history via GET /api/payments/history', async () => {
		const { accessToken, userId } = await signupAndLogin(env, 'history@example.com', 'strong-pass');

		// Seed payments
		env.DB.payments.push(
			{ id: 'p1', userId, amount: 18, currency: 'USD', status: 'completed', paymentMethod: 'crypto', packageId: 'basic', createdAt: '2026-01-01T00:00:00Z' },
			{ id: 'p2', userId, amount: 38, currency: 'USD', status: 'completed', paymentMethod: 'card', packageId: 'pro', createdAt: '2026-02-01T00:00:00Z' },
		);

		const response = await worker.fetch(
			new Request('http://example.com/api/payments/history', {
				headers: { Authorization: `Bearer ${accessToken}` },
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const data = await response.json() as { payments: { id: string }[] };
		expect(data.payments).toHaveLength(2);
		// Most recent first
		expect(data.payments[0].id).toBe('p2');
	});

	it('downgrades expired subscriptions to free in /api/me', async () => {
		const { accessToken, userId } = await signupAndLogin(env, 'expired@example.com', 'strong-pass');

		// Set user to basic with an expired subscription
		const user = env.DB.users.get(userId)!;
		user.tier = 'basic';
		user.subscriptionPlan = 'basic';
		user.subscriptionEndDate = '2020-01-01T00:00:00Z'; // long ago

		const response = await worker.fetch(
			new Request('http://example.com/api/me', {
				headers: { Authorization: `Bearer ${accessToken}` },
			}),
			env as never,
			createExecutionContext(),
		);

		const body = await response.json() as { user: { tier: string; subscriptionPlan: string } };
		expect(response.status).toBe(200);
		expect(body.user.tier).toBe('free');
		expect(body.user.subscriptionPlan).toBe('free');
	});
});
