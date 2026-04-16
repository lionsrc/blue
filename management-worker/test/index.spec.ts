import { beforeEach, describe, expect, it } from 'vitest';
import * as jwt from '@tsndr/cloudflare-worker-jwt';
import worker from '../src';
import { _resetRateLimitBucketsForTesting, hashPassword } from '../src/auth';

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
	emailVerified: number;
	verificationCode?: string | null;
};

type NodeRow = {
	id: string;
	name: string;
	publicIp: string;
	status: string;
	activeConnections: number;
	cpuLoad: number;
	lastPing: string | null;
	agentTokenHash?: string | null;
	ipUpdatedAt?: string | null;
	createdAt?: string;
};

type NodeIpHistoryRow = {
	id: string;
	nodeId: string;
	previousIp: string | null;
	newIp: string;
	changedAt: string;
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
	RESEND_API_KEY: string;
	CORS_ALLOW_ORIGINS?: string;
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
	nodeIpHistory: NodeIpHistoryRow[] = [];

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

		if (sql.includes('SELECT id, publicIp, agentTokenHash FROM Nodes WHERE id = ?')) {
			const node = this.nodes.get(String(args[0]));
			if (!node) return null;
			return {
				id: node.id,
				publicIp: node.publicIp,
				agentTokenHash: node.agentTokenHash ?? null,
			} as T;
		}

		if (sql.includes('SELECT id, publicIp FROM Nodes WHERE publicIp = ? AND agentTokenHash IS NULL LIMIT 1')) {
			const publicIp = String(args[0]);
			for (const node of this.nodes.values()) {
				if (node.publicIp === publicIp && !node.agentTokenHash) {
					return {
						id: node.id,
						publicIp: node.publicIp,
					} as T;
				}
			}
			return null;
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

		if (sql.includes('SELECT COUNT(*) as total FROM Users u')) {
			let results = Array.from(this.users.values());
			if (sql.includes('u.email LIKE ?')) {
				const searchTerm = String(args[0]).replace(/%/g, '');
				results = results.filter((u) => u.email.includes(searchTerm));
			}
			if (sql.includes('u.tier = ?')) {
				const tierArgIdx = sql.includes('u.email LIKE ?') ? 1 : 0;
				const tierSearch = String(args[tierArgIdx]);
				results = results.filter((u) => u.tier === tierSearch);
			}
			return { total: results.length } as T;
		}

		if (sql.includes('SELECT id, email FROM Users WHERE id = ?')) {
			const user = this.users.get(String(args[0]));
			if (!user) return null;
			return {
				id: user.id,
				email: user.email,
			} as T;
		}

		if (sql.includes('FROM UserAllocations a') && sql.includes('WHERE a.userId = ?') && sql.includes('currentNodeName')) {
			const userId = String(args[0]);
			const allocation = this.allocations.find((candidate) => candidate.userId === userId);
			if (!allocation) return null;
			const node = this.nodes.get(allocation.nodeId);
			if (!node) throw new Error('Node not found');
			return {
				...allocation,
				currentNodeName: node.name,
				currentNodePublicIp: node.publicIp,
			} as T;
		}

		if (sql.includes('SELECT id, name, publicIp, status FROM Nodes WHERE id = ?')) {
			const node = this.nodes.get(String(args[0]));
			if (!node) return null;
			return {
				id: node.id,
				name: node.name,
				publicIp: node.publicIp,
				status: node.status,
			} as T;
		}

		if (sql.includes('SELECT id, name FROM Nodes WHERE id = ?')) {
			const node = this.nodes.get(String(args[0]));
			if (!node) return null;
			return {
				id: node.id,
				name: node.name,
			} as T;
		}

		throw new Error(`Unhandled first() SQL: ${sql}`);
	}

	async run(sql: string, args: unknown[]) {
		if (sql.includes('INSERT INTO Users')) {
			const [id, email, passwordHash, initialEmailVerified, verificationCode] = args as [string, string, string, number, string];
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
				emailVerified: initialEmailVerified ?? 0,
				verificationCode: verificationCode ?? null,
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

		if (sql.includes('INSERT INTO Nodes')) {
			const [id, name, publicIp, agentTokenHash] = args as [string, string, string, string?];
			this.nodes.set(id, {
				id,
				name,
				publicIp,
				status: 'provisioning',
				activeConnections: 0,
				cpuLoad: 0,
				lastPing: null,
				agentTokenHash: agentTokenHash ?? null,
				ipUpdatedAt: null,
				createdAt: new Date().toISOString(),
			});
			return { success: true };
		}

		if (sql.includes('INSERT INTO NodeIpHistory')) {
			const [id, nodeId, previousIp, newIp] = args as [string, string, string | null, string];
			this.nodeIpHistory.push({
				id,
				nodeId,
				previousIp,
				newIp,
				changedAt: new Date().toISOString(),
			});
			return { success: true };
		}

		if (sql.includes('UPDATE Nodes') && sql.includes('SET publicIp = ?')) {
			const [publicIp, cpuLoad, activeConnections, nodeId] = args as [string, number | null, number | null, string];
			const node = this.nodes.get(nodeId);
			if (!node) throw new Error('Node not found');
			node.publicIp = publicIp;
			node.ipUpdatedAt = new Date().toISOString();
			if (cpuLoad !== null) node.cpuLoad = cpuLoad;
			if (activeConnections !== null) node.activeConnections = activeConnections;
			node.status = 'active';
			node.lastPing = new Date().toISOString();
			return { success: true };
		}

			if (sql.includes('UPDATE Nodes SET agentTokenHash = ? WHERE id = ?')) {
				const [agentTokenHash, nodeId] = args as [string, string];
				const node = this.nodes.get(nodeId);
				if (!node) throw new Error('Node not found');
				node.agentTokenHash = agentTokenHash;
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

		if (sql.includes('UPDATE Users SET email = ?, emailVerified = 0, verificationCode = ? WHERE id = ?')) {
			const [email, verificationCode, userId] = args as [string, string, string];
			const user = this.users.get(userId);
			if (!user) throw new Error('User not found');
			// Check for UNIQUE email constraint
			for (const u of this.users.values()) {
				if (u.email === email && u.id !== userId) throw new Error('UNIQUE constraint failed');
			}
			user.email = email;
			user.emailVerified = 0;
			user.verificationCode = verificationCode;
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

		if (sql.includes('UPDATE Users SET emailVerified = 1')) {
			const userId = String(args[0]);
			const user = this.users.get(userId);
			if (!user) throw new Error('User not found');
			user.emailVerified = 1;
			user.verificationCode = null;
			return { success: true };
		}

		if (sql.includes('UPDATE Users SET verificationCode = ? WHERE id = ?')) {
			const [code, userId] = args as [string, string];
			const user = this.users.get(userId);
			if (!user) throw new Error('User not found');
			user.verificationCode = code;
			return { success: true };
		}

		if (sql.includes('UPDATE UserAllocations SET nodeId = ?, port = ? WHERE id = ?')) {
			const [nodeId, port, allocationId] = args as [string, number, string];
			this.allocations = this.allocations.map((allocation) => (
				allocation.id === allocationId
					? { ...allocation, nodeId, port }
					: allocation
			));
			return { success: true };
		}

		if (sql.includes('UPDATE Nodes SET activeConnections = activeConnections + 1 WHERE id = ?')) {
			const node = this.nodes.get(String(args[0]));
			if (!node) throw new Error('Node not found');
			node.activeConnections += 1;
			return { success: true };
		}

		if (sql.includes('SET activeConnections = CASE') && sql.includes('WHERE id = ?')) {
			const node = this.nodes.get(String(args[0]));
			if (!node) throw new Error('Node not found');
			node.activeConnections = Math.max(0, node.activeConnections - 1);
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

			if (sql.includes('FROM NodeIpHistory')) {
				const nodeId = String(args[0]);
				const limit = Number(args[1]);
				return {
					results: this.nodeIpHistory
						.filter((entry) => entry.nodeId === nodeId)
						.sort((left, right) => right.changedAt.localeCompare(left.changedAt))
						.slice(0, limit)
						.map((entry) => ({ ...entry })),
				} as { results: T[] };
			}

			if (sql.includes('SELECT u.id, u.email, u.tier, u.subscriptionPlan, u.bandwidthLimitMbps')) {
				const limit = Number(args[args.length - 2]);
				const offset = Number(args[args.length - 1]);
			let results = Array.from(this.users.values());

			if (sql.includes('u.email LIKE ?')) {
				const searchTerm = String(args[0]).replace(/%/g, '');
				results = results.filter((u) => u.email.includes(searchTerm));
			}
			if (sql.includes('u.tier = ?')) {
				const tierArgIdx = sql.includes('u.email LIKE ?') ? 1 : 0;
				const tierSearch = String(args[tierArgIdx]);
				results = results.filter((u) => u.tier === tierSearch);
			}

			results = results.slice(offset, offset + limit);

			return {
				results: results.map((user) => {
					const allocation = this.allocations.find((candidate) => candidate.userId === user.id) ?? null;
					const node = allocation ? this.nodes.get(allocation.nodeId) ?? null : null;
					return {
						...user,
						createdAt: new Date().toISOString(),
						nodeId: allocation?.nodeId ?? null,
						port: allocation?.port ?? null,
						nodeName: node?.name ?? null,
						nodePublicIp: node?.publicIp ?? null,
					};
				}),
				} as { results: T[] };
			}

			if (sql.includes('FROM Nodes n') && sql.includes('allocationCount')) {
				const results = Array.from(this.nodes.values())
					.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
					.map((node) => ({
						id: node.id,
						name: node.name,
						publicIp: node.publicIp,
						status: node.status,
						activeConnections: node.activeConnections,
						cpuLoad: node.cpuLoad,
						lastPing: node.lastPing,
						ipUpdatedAt: node.ipUpdatedAt ?? null,
						agentTokenConfigured: node.agentTokenHash ? 1 : 0,
						allocationCount: this.allocations.filter((allocation) => allocation.nodeId === node.id).length,
					}));

				return { results } as { results: T[] };
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
		RESEND_API_KEY: 'test-resend-api-key',
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
		const signupData = await signupRes.json() as { requiresVerification?: boolean };
		expect(signupData.requiresVerification).toBe(true);

		// Find the user in the DB and manually verify their email
		let userId = '';
		for (const [id, user] of testEnv.DB.users.entries()) {
			if (user.email === email.trim().toLowerCase()) {
				userId = id;
				user.emailVerified = 1;
				user.verificationCode = null;
				break;
			}
		}
		expect(userId).toBeTruthy();

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
			emailVerified: 1,
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
			emailVerified: 1,
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

		// Manually verify email so login succeeds
		for (const user of env.DB.users.values()) {
			if (user.email === 'exp@example.com') { user.emailVerified = 1; break; }
		}

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
			emailVerified: 1,
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

		it('authenticates tokenized nodes by node id without requiring X-Agent-Secret', async () => {
			const agentToken = 'stable-agent-token';
			env.DB.nodes.set('node-stable', {
				id: 'node-stable',
				name: 'stable-node',
				publicIp: '198.51.100.20',
				status: 'provisioning',
				activeConnections: 0,
				cpuLoad: 0,
				lastPing: null,
				agentTokenHash: await hashPassword(agentToken),
				ipUpdatedAt: null,
			});

			const response = await worker.fetch(
				new Request('http://example.com/api/agent/config', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Node-Id': 'node-stable',
						'X-Agent-Token': agentToken,
					},
					body: JSON.stringify({
						cpuLoad: 2.25,
						activeConnections: 4,
						publicIp: '203.0.113.44',
					}),
				}),
				env as never,
				createExecutionContext(),
			);

			expect(response.status).toBe(200);
			expect(env.DB.nodes.get('node-stable')).toEqual(expect.objectContaining({
				publicIp: '203.0.113.44',
				status: 'active',
				cpuLoad: 2.25,
				activeConnections: 4,
			}));
			expect(env.DB.nodes.get('node-stable')?.ipUpdatedAt).toBeTruthy();
			expect(env.DB.nodeIpHistory).toHaveLength(1);
			expect(env.DB.nodeIpHistory[0]).toEqual(expect.objectContaining({
				nodeId: 'node-stable',
				previousIp: '198.51.100.20',
				newIp: '203.0.113.44',
			}));
		});

		it('does not add IP history when a tokenized node reports the same IP', async () => {
			const agentToken = 'same-ip-token';
			env.DB.nodes.set('node-stable', {
				id: 'node-stable',
				name: 'stable-node',
				publicIp: '198.51.100.20',
				status: 'provisioning',
				activeConnections: 0,
				cpuLoad: 0,
				lastPing: null,
				agentTokenHash: await hashPassword(agentToken),
				ipUpdatedAt: null,
			});

			const response = await worker.fetch(
				new Request('http://example.com/api/agent/config', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Node-Id': 'node-stable',
						'X-Agent-Token': agentToken,
						'X-Agent-Secret': env.AGENT_SECRET,
					},
					body: JSON.stringify({
						cpuLoad: 0.75,
						activeConnections: 2,
						publicIp: '198.51.100.20',
					}),
				}),
				env as never,
				createExecutionContext(),
			);

			expect(response.status).toBe(200);
			expect(env.DB.nodeIpHistory).toHaveLength(0);
			expect(env.DB.nodes.get('node-stable')?.publicIp).toBe('198.51.100.20');
		});

		it('rejects tokenized nodes with the wrong token', async () => {
			env.DB.nodes.set('node-stable', {
				id: 'node-stable',
				name: 'stable-node',
				publicIp: '198.51.100.20',
				status: 'provisioning',
				activeConnections: 0,
				cpuLoad: 0,
				lastPing: null,
				agentTokenHash: await hashPassword('correct-token'),
				ipUpdatedAt: null,
			});

			const response = await worker.fetch(
				new Request('http://example.com/api/agent/config', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Node-Id': 'node-stable',
						'X-Agent-Token': 'wrong-token',
						'X-Agent-Secret': env.AGENT_SECRET,
					},
					body: JSON.stringify({ publicIp: '198.51.100.20' }),
				}),
				env as never,
				createExecutionContext(),
			);

			expect(response.status).toBe(401);
			expect(env.DB.nodeIpHistory).toHaveLength(0);
			expect(env.DB.nodes.get('node-stable')?.lastPing).toBeNull();
		});

		it('allows multiple tokenized nodes to report the same public IP', async () => {
			env.DB.nodes.set('node-a', {
				id: 'node-a',
				name: 'node-a',
				publicIp: '203.0.113.50',
				status: 'provisioning',
				activeConnections: 0,
				cpuLoad: 0,
				lastPing: null,
				agentTokenHash: await hashPassword('token-a'),
				ipUpdatedAt: null,
			});
			env.DB.nodes.set('node-b', {
				id: 'node-b',
				name: 'node-b',
				publicIp: '203.0.113.50',
				status: 'provisioning',
				activeConnections: 0,
				cpuLoad: 0,
				lastPing: null,
				agentTokenHash: await hashPassword('token-b'),
				ipUpdatedAt: null,
			});

			const [responseA, responseB] = await Promise.all([
				worker.fetch(
					new Request('http://example.com/api/agent/config', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Node-Id': 'node-a',
							'X-Agent-Token': 'token-a',
							'X-Agent-Secret': env.AGENT_SECRET,
						},
						body: JSON.stringify({ publicIp: '203.0.113.50' }),
					}),
					env as never,
					createExecutionContext(),
				),
				worker.fetch(
					new Request('http://example.com/api/agent/config', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Node-Id': 'node-b',
							'X-Agent-Token': 'token-b',
							'X-Agent-Secret': env.AGENT_SECRET,
						},
						body: JSON.stringify({ publicIp: '203.0.113.50' }),
					}),
					env as never,
					createExecutionContext(),
				),
			]);

			expect(responseA.status).toBe(200);
			expect(responseB.status).toBe(200);
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
			emailVerified: 1,
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
			emailVerified: 1,
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
			emailVerified: 1,
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

		it('redirects back to an allowed admin origin after session bootstrap', async () => {
			env.CF_ACCESS_AUD = '';
			env.CORS_ALLOW_ORIGINS = 'https://admin.blue2000.cc';

			const response = await worker.fetch(
				new Request('http://example.com/api/admin/session?returnTo=https%3A%2F%2Fadmin.blue2000.cc%2Fdashboard'),
				env as never,
				createExecutionContext(),
			);

			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('https://admin.blue2000.cc/dashboard');
		});

		it('rejects invalid admin session bootstrap return URLs', async () => {
			env.CF_ACCESS_AUD = '';
			env.CORS_ALLOW_ORIGINS = 'https://admin.blue2000.cc';

			const response = await worker.fetch(
				new Request('http://example.com/api/admin/session?returnTo=https%3A%2F%2Fevil.example%2Fphish'),
				env as never,
				createExecutionContext(),
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: 'Invalid returnTo URL',
			});
		});

			it('returns a one-time agent token when an admin registers a node', async () => {
				env.CF_ACCESS_AUD = '';

				const response = await worker.fetch(
					new Request('http://example.com/api/admin/nodes', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ name: 'Seoul 1', publicIp: '203.0.113.30' }),
					}),
					env as never,
					createExecutionContext(),
				);

				expect(response.status).toBe(200);
				const data = await response.json() as { nodeId: string; agentToken: string };
				expect(data.nodeId).toBeTruthy();
				expect(data.agentToken).toBeTruthy();
				expect(env.DB.nodes.get(data.nodeId)?.agentTokenHash).toMatch(/^pbkdf2:/);

				const listResponse = await worker.fetch(
					new Request('http://example.com/api/admin/nodes'),
					env as never,
					createExecutionContext(),
				);
				expect(listResponse.status).toBe(200);
				expect(JSON.stringify(await listResponse.json())).not.toContain(data.agentToken);
			});

			it('rotates node tokens and rejects the old token afterwards', async () => {
				env.CF_ACCESS_AUD = '';
				env.DB.nodes.set('node-rotate', {
					id: 'node-rotate',
					name: 'Rotate Me',
					publicIp: '203.0.113.61',
					status: 'provisioning',
					activeConnections: 0,
					cpuLoad: 0,
					lastPing: null,
					agentTokenHash: await hashPassword('old-token'),
					ipUpdatedAt: null,
				});

				const rotateResponse = await worker.fetch(
					new Request('http://example.com/api/admin/nodes/node-rotate/rotate-token', {
						method: 'POST',
					}),
					env as never,
					createExecutionContext(),
				);

				expect(rotateResponse.status).toBe(200);
				const rotateData = await rotateResponse.json() as { agentToken: string };
				expect(rotateData.agentToken).toBeTruthy();
				expect(rotateData.agentToken).not.toBe('old-token');

				const oldTokenResponse = await worker.fetch(
					new Request('http://example.com/api/agent/config', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Node-Id': 'node-rotate',
							'X-Agent-Token': 'old-token',
							'X-Agent-Secret': env.AGENT_SECRET,
						},
						body: JSON.stringify({ publicIp: '203.0.113.61' }),
					}),
					env as never,
					createExecutionContext(),
				);
				expect(oldTokenResponse.status).toBe(401);

				const newTokenResponse = await worker.fetch(
					new Request('http://example.com/api/agent/config', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Node-Id': 'node-rotate',
							'X-Agent-Token': rotateData.agentToken,
							'X-Agent-Secret': env.AGENT_SECRET,
						},
						body: JSON.stringify({ publicIp: '203.0.113.61' }),
					}),
					env as never,
					createExecutionContext(),
				);
				expect(newTokenResponse.status).toBe(200);
			});

			it('returns node IP history for admins', async () => {
				env.CF_ACCESS_AUD = '';
				env.DB.nodes.set('node-history', {
					id: 'node-history',
					name: 'History Node',
					publicIp: '203.0.113.71',
					status: 'active',
					activeConnections: 0,
					cpuLoad: 0,
					lastPing: new Date().toISOString(),
					agentTokenHash: await hashPassword('history-token'),
					ipUpdatedAt: new Date().toISOString(),
				});
				env.DB.nodeIpHistory.push(
					{
						id: 'hist-older',
						nodeId: 'node-history',
						previousIp: '198.51.100.1',
						newIp: '198.51.100.2',
						changedAt: '2026-01-01T00:00:00.000Z',
					},
					{
						id: 'hist-newer',
						nodeId: 'node-history',
						previousIp: '198.51.100.2',
						newIp: '203.0.113.71',
						changedAt: '2026-02-01T00:00:00.000Z',
					},
				);

				const response = await worker.fetch(
					new Request('http://example.com/api/admin/nodes/node-history/ip-history?limit=1'),
					env as never,
					createExecutionContext(),
				);

				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					nodeId: 'node-history',
					nodeName: 'History Node',
					history: [
						expect.objectContaining({
							id: 'hist-newer',
							previousIp: '198.51.100.2',
							newIp: '203.0.113.71',
						}),
					],
				});
			});

			it('moves a user allocation to another active node and preserves the UUID', async () => {
				env.CF_ACCESS_AUD = '';
				env.DB.nodes.set('node-a', {
				id: 'node-a',
				name: 'Tokyo 1',
				publicIp: '203.0.113.10',
				status: 'active',
				activeConnections: 4,
				cpuLoad: 0,
				lastPing: new Date().toISOString(),
			});
			env.DB.nodes.set('node-b', {
				id: 'node-b',
				name: 'Tokyo 2',
				publicIp: '203.0.113.11',
				status: 'active',
				activeConnections: 1,
				cpuLoad: 0,
				lastPing: new Date().toISOString(),
			});
			env.DB.users.set('user-move', {
				id: 'user-move',
				email: 'move@example.com',
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
				emailVerified: 1,
			});
			env.DB.allocations.push({
				id: 'alloc-user-move',
				userId: 'user-move',
				nodeId: 'node-a',
				xrayUuid: 'uuid-move',
				port: 12001,
				speedLimitMbps: 300,
			});
			env.DB.allocations.push({
				id: 'alloc-node-b-existing',
				userId: 'someone-else',
				nodeId: 'node-b',
				xrayUuid: 'uuid-existing',
				port: 10000,
				speedLimitMbps: 100,
			});

			const response = await worker.fetch(
				new Request('http://example.com/api/admin/users/user-move/move', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ nodeId: 'node-b' }),
				}),
				env as never,
				createExecutionContext(),
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				message: 'User move@example.com moved to Tokyo 2',
				allocation: expect.objectContaining({
					userId: 'user-move',
					nodeId: 'node-b',
					nodeName: 'Tokyo 2',
					nodePublicIp: '203.0.113.11',
					port: 10001,
					xrayUuid: 'uuid-move',
					speedLimitMbps: 300,
					previousNodeId: 'node-a',
					previousNodeName: 'Tokyo 1',
					previousNodePublicIp: '203.0.113.10',
				}),
			});

			expect(env.DB.allocations.find((allocation) => allocation.id === 'alloc-user-move')).toEqual({
				id: 'alloc-user-move',
				userId: 'user-move',
				nodeId: 'node-b',
				xrayUuid: 'uuid-move',
				port: 10001,
				speedLimitMbps: 300,
			});
			expect(env.DB.nodes.get('node-a')?.activeConnections).toBe(3);
			expect(env.DB.nodes.get('node-b')?.activeConnections).toBe(2);
		});

		it('rejects moves to inactive nodes', async () => {
			env.CF_ACCESS_AUD = '';
			env.DB.nodes.set('node-a', {
				id: 'node-a',
				name: 'Tokyo 1',
				publicIp: '203.0.113.10',
				status: 'active',
				activeConnections: 2,
				cpuLoad: 0,
				lastPing: new Date().toISOString(),
			});
			env.DB.nodes.set('node-b', {
				id: 'node-b',
				name: 'Tokyo 2',
				publicIp: '203.0.113.11',
				status: 'offline',
				activeConnections: 0,
				cpuLoad: 0,
				lastPing: null,
			});
			env.DB.users.set('user-move', {
				id: 'user-move',
				email: 'move@example.com',
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
				emailVerified: 1,
			});
			env.DB.allocations.push({
				id: 'alloc-user-move',
				userId: 'user-move',
				nodeId: 'node-a',
				xrayUuid: 'uuid-move',
				port: 12001,
				speedLimitMbps: 300,
			});

			const response = await worker.fetch(
				new Request('http://example.com/api/admin/users/user-move/move', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ nodeId: 'node-b' }),
				}),
				env as never,
				createExecutionContext(),
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: 'Destination node must be active before reassignment',
			});
			expect(env.DB.allocations.find((allocation) => allocation.id === 'alloc-user-move')?.nodeId).toBe('node-a');
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

		// Manually verify email so login works
		for (const user of env.DB.users.values()) {
			if (user.email === 'pbkdf2@example.com') { user.emailVerified = 1; break; }
		}

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

	it('signup returns requiresVerification and stores a verification code', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'verify-test@example.com', password: 'strong-pass' }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const data = await response.json() as { requiresVerification: boolean };
		expect(data.requiresVerification).toBe(true);

		const user = Array.from(env.DB.users.values()).find((u) => u.email === 'verify-test@example.com');
		expect(user).toBeDefined();
		expect(user!.emailVerified).toBe(0);
		expect(user!.verificationCode).toMatch(/^\d{6}:\d+$/);
	});

	it('blocks login for unverified users', async () => {
		await worker.fetch(
			new Request('http://example.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'unverified@example.com', password: 'strong-pass' }),
			}),
			env as never,
			createExecutionContext(),
		);

		const response = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'unverified@example.com', password: 'strong-pass' }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(response.status).toBe(403);
		const data = await response.json() as { requiresVerification: boolean; error: string };
		expect(data.requiresVerification).toBe(true);
		expect(data.error).toContain('verify');
	});

	it('verifies email via POST /api/verify-email', async () => {
		await worker.fetch(
			new Request('http://example.com/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'code-test@example.com', password: 'strong-pass' }),
			}),
			env as never,
			createExecutionContext(),
		);

		const user = Array.from(env.DB.users.values()).find((u) => u.email === 'code-test@example.com')!;
		const codePayload = user.verificationCode;
		const code = codePayload!.split(':')[0];

		const verifyResponse = await worker.fetch(
			new Request('http://example.com/api/verify-email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'code-test@example.com', code }),
			}),
			env as never,
			createExecutionContext(),
		);

		expect(verifyResponse.status).toBe(200);
		expect(user.emailVerified).toBe(1);
		expect(user.verificationCode).toBeNull();

		// Login should now succeed
		const loginResponse = await worker.fetch(
			new Request('http://example.com/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'code-test@example.com', password: 'strong-pass' }),
			}),
			env as never,
			createExecutionContext(),
		);
		expect(loginResponse.status).toBe(200);
		const loginData = await loginResponse.json() as { accessToken: string };
		expect(loginData.accessToken).toBeTruthy();
	});

		it('admin gets paginated, filtered, and searched users', async () => {
			env.CF_ACCESS_AUD = '';

			// Seed a few users for testing
			for (let i = 0; i < 5; i++) {
				await worker.fetch(
					new Request('http://example.com/api/signup', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email: `testuser${i}@example.com`, password: 'strong-pass' }),
					}),
					env as never,
					createExecutionContext(),
				);
			}

		// Make one a pro user
		const proUser = Array.from(env.DB.users.values()).find(u => u.email === 'testuser3@example.com')!;
		proUser.tier = 'pro';

			// Test pagination limit
			const resList = await worker.fetch(
				new Request('http://example.com/api/admin/users?page=1&limit=2'),
				env as never,
				createExecutionContext(),
			);
			const dataList = await resList.json() as any;
			expect(dataList.users.length).toBe(2);
			expect(dataList.total).toBeGreaterThanOrEqual(5);

			// Test search
			const resSearch = await worker.fetch(
				new Request('http://example.com/api/admin/users?search=testuser2'),
				env as never,
				createExecutionContext(),
			);
			const dataSearch = await resSearch.json() as any;
			expect(dataSearch.users.length).toBe(1);
			expect(dataSearch.users[0].email).toBe('testuser2@example.com');

			// Test tier filter
			const resTier = await worker.fetch(
				new Request('http://example.com/api/admin/users?tier=pro'),
				env as never,
				createExecutionContext(),
			);
			const dataTier = await resTier.json() as any;
			expect(dataTier.users.length).toBe(1);
			expect(dataTier.users[0].tier).toBe('pro');
	});
});
