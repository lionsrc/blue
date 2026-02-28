import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as jwt from '@tsndr/cloudflare-worker-jwt';
import { v4 as uuidv4 } from 'uuid';

type Bindings = {
	DB: D1Database;
	JWT_SECRET: string;
	AGENT_SECRET: string;
	SESSION_TOKEN_SECRET: string;
	USAGE_REPORT_SECRET: string;
	CF_ACCESS_TEAM_DOMAIN: string;
	CF_ACCESS_AUD: string;
	ADMIN_ALLOW_EMAILS?: string;
	CORS_ALLOW_ORIGINS?: string;
};

type RequiredSecretBinding =
	| 'JWT_SECRET'
	| 'AGENT_SECRET'
	| 'SESSION_TOKEN_SECRET'
	| 'USAGE_REPORT_SECRET'
	| 'CF_ACCESS_TEAM_DOMAIN'
	| 'CF_ACCESS_AUD';

type OptionalBinding =
	| 'ADMIN_ALLOW_EMAILS'
	| 'CORS_ALLOW_ORIGINS';

type AccessJwtPayload = {
	aud?: string | string[];
	email?: string;
	sub?: string;
};

type AgentSyncPayload = {
	cpuLoad: number | null;
	activeConnections: number | null;
};

type PlanId = 'free' | 'basic' | 'pro';

type PlanDefinition = {
	id: PlanId;
	monthlyPriceUsd: number;
	bandwidthLimitMbps: number;
	monthlyTrafficLimitGb: number;
	deviceLimit: number | null;
};

type PackageSelection = {
	planId: PlanId;
	monthsToAdd: number | null;
	expectedAmount: number;
};

type ProxySessionPayload = {
	userId: string;
	planId: PlanId;
	xrayUuid: string;
	issuedAt: number;
};

type AccessJwk = JsonWebKey & {
	kid: string;
	alg?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const HASH_PREFIX = 'sha256';
const HASH_SCHEME_PREFIX = `${HASH_PREFIX}:`;
const DEFAULT_CORS_ORIGINS = [
	'http://localhost:5173',
	'http://localhost:5174',
	'http://localhost:5175',
];
const BYTES_PER_GB = 1024 * 1024 * 1024;
const PLAN_ORDER: PlanId[] = ['free', 'basic', 'pro'];
const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
	free: {
		id: 'free',
		monthlyPriceUsd: 0,
		bandwidthLimitMbps: 1,
		monthlyTrafficLimitGb: 50,
		deviceLimit: 1,
	},
	basic: {
		id: 'basic',
		monthlyPriceUsd: 18,
		bandwidthLimitMbps: 300,
		monthlyTrafficLimitGb: 200,
		deviceLimit: null,
	},
	pro: {
		id: 'pro',
		monthlyPriceUsd: 38,
		bandwidthLimitMbps: 600,
		monthlyTrafficLimitGb: 500,
		deviceLimit: null,
	},
};
const PACKAGE_PLAN_MAP: Record<string, { planId: PlanId; monthsToAdd: number | null }> = {
	free: { planId: 'free', monthsToAdd: null },
	basic: { planId: 'basic', monthsToAdd: 1 },
	basic_monthly: { planId: 'basic', monthsToAdd: 1 },
	pro: { planId: 'pro', monthsToAdd: 1 },
	pro_monthly: { planId: 'pro', monthsToAdd: 1 },
	'1_month_pro': { planId: 'pro', monthsToAdd: 1 },
	'1_year_pro': { planId: 'pro', monthsToAdd: 12 },
	recurring_monthly: { planId: 'pro', monthsToAdd: 1 },
};
const ACCESS_CERT_CACHE_TTL_MS = 5 * 60 * 1000;
let accessJwkCache: { teamDomain: string; expiresAt: number; keys: AccessJwk[] } | null = null;

// Enable CORS for all routes
app.use('/*', cors({
	origin: (origin: string, c) => {
		if (!origin) return null;
		return getAllowedCorsOrigins(c).has(origin) ? origin : null;
	},
	allowHeaders: ['Content-Type', 'Authorization', 'X-Node-IP', 'X-Agent-Secret', 'X-Health-Check', 'X-Usage-Secret'],
	allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
	credentials: true,
}));

const getOptionalBinding = (c: any, bindingName: OptionalBinding) => {
	return c.env[bindingName]?.trim() || '';
};

const isPlanId = (value: string): value is PlanId => value in PLAN_DEFINITIONS;

const resolvePlanId = (subscriptionPlan: unknown, tier: unknown): PlanId => {
	if (typeof subscriptionPlan === 'string' && isPlanId(subscriptionPlan)) {
		return subscriptionPlan;
	}

	if (typeof tier === 'string' && isPlanId(tier)) {
		return tier;
	}

	if (tier === 'pro') {
		return 'pro';
	}

	return 'free';
};

const getPlanDefinition = (planId: PlanId) => {
	return PLAN_DEFINITIONS[planId];
};

const getPackageSelection = (packageId: unknown): PackageSelection | null => {
	if (typeof packageId !== 'string') {
		return null;
	}

	const selectedPackage = PACKAGE_PLAN_MAP[packageId];
	if (!selectedPackage) {
		return null;
	}

	const plan = getPlanDefinition(selectedPackage.planId);
	return {
		planId: selectedPackage.planId,
		monthsToAdd: selectedPackage.monthsToAdd,
		expectedAmount: selectedPackage.monthsToAdd
			? plan.monthlyPriceUsd * selectedPackage.monthsToAdd
			: 0,
	};
};

const getUsagePeriodStart = (referenceDate = new Date()) => {
	return new Date(Date.UTC(
		referenceDate.getUTCFullYear(),
		referenceDate.getUTCMonth(),
		1,
		0,
		0,
		0,
		0,
	)).toISOString();
};

const normalizeUsageBytes = (value: unknown) => {
	const parsedValue = parseNumericValue(value);
	if (parsedValue === null) {
		return 0;
	}

	return Math.max(0, Math.trunc(parsedValue));
};

const getCurrentPeriodBytesUsed = (periodStart: unknown, bytesUsed: unknown, referenceDate = new Date()) => {
	const expectedPeriodStart = getUsagePeriodStart(referenceDate);
	if (typeof periodStart !== 'string' || periodStart !== expectedPeriodStart) {
		return 0;
	}

	return normalizeUsageBytes(bytesUsed);
};

const getPlanMonthlyQuotaBytes = (planId: PlanId) => {
	return getPlanDefinition(planId).monthlyTrafficLimitGb * BYTES_PER_GB;
};

const isQuotaExceeded = (planId: PlanId, currentPeriodBytesUsed: number) => {
	return currentPeriodBytesUsed >= getPlanMonthlyQuotaBytes(planId);
};

const bytesToGb = (bytesUsed: number) => {
	return Number((bytesUsed / BYTES_PER_GB).toFixed(2));
};

const getAllowedCorsOrigins = (c: any) => {
	const configuredOrigins = getOptionalBinding(c, 'CORS_ALLOW_ORIGINS')
		.split(',')
		.map((origin: string) => origin.trim())
		.filter(Boolean);

	return new Set([...DEFAULT_CORS_ORIGINS, ...configuredOrigins]);
};

const requireSecret = (c: any, secretName: RequiredSecretBinding) => {
	const secret = c.env[secretName];
	if (!secret) {
		throw new Error(`Missing required secret: ${secretName}`);
	}
	return secret;
};

const getAllowedAdminEmails = (c: any) => {
	const allowlist = getOptionalBinding(c, 'ADMIN_ALLOW_EMAILS');
	if (!allowlist) {
		return null;
	}

	return new Set(
		allowlist
			.split(',')
			.map((email: string) => email.trim().toLowerCase())
			.filter(Boolean)
	);
};

const normalizeAccessTeamDomain = (teamDomain: string) => {
	const trimmed = teamDomain.trim().replace(/\/+$/, '');
	if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
		return trimmed;
	}
	return `https://${trimmed}`;
};

const getAccessJwks = async (c: any) => {
	const teamDomain = normalizeAccessTeamDomain(requireSecret(c, 'CF_ACCESS_TEAM_DOMAIN'));
	const now = Date.now();

	if (accessJwkCache && accessJwkCache.teamDomain === teamDomain && accessJwkCache.expiresAt > now) {
		return accessJwkCache.keys;
	}

	const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
	if (!res.ok) {
		throw new Error('Failed to fetch Cloudflare Access signing keys');
	}

	const data = await res.json() as { keys?: AccessJwk[] };
	const keys = Array.isArray(data.keys)
		? data.keys.filter((key): key is AccessJwk => typeof key.kid === 'string' && key.kid.length > 0)
		: [];
	if (keys.length === 0) {
		throw new Error('No Cloudflare Access signing keys available');
	}

	accessJwkCache = {
		teamDomain,
		expiresAt: now + ACCESS_CERT_CACHE_TTL_MS,
		keys,
	};

	return keys;
};

const encodeBase64 = (value: string) => btoa(value);
const encodeBase64Url = (value: string) => (
	btoa(value)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '')
);

const encodeBase64UrlBytes = (bytes: Uint8Array) => {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return encodeBase64Url(binary);
};

const toHex = (buffer: ArrayBuffer) => {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
};

const createSalt = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return toHex(bytes.buffer);
};

const hashPasswordWithSalt = async (password: string, salt: string) => {
	const data = new TextEncoder().encode(`${salt}:${password}`);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return `${HASH_PREFIX}:${salt}:${toHex(digest)}`;
};

const hashPassword = async (password: string) => {
	return hashPasswordWithSalt(password, createSalt());
};

const signProxySessionToken = async (c: any, payload: ProxySessionPayload) => {
	const payloadSegment = encodeBase64Url(JSON.stringify(payload));
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(requireSecret(c, 'SESSION_TOKEN_SECRET')),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadSegment));
	const signatureSegment = encodeBase64UrlBytes(new Uint8Array(signature));

	return `${payloadSegment}.${signatureSegment}`;
};

const verifyPassword = async (password: string, storedValue: string) => {
	const [prefix, salt, expectedHash] = storedValue.split(':');
	if (prefix !== HASH_PREFIX || !salt || !expectedHash) {
		return false;
	}

	const candidate = await hashPasswordWithSalt(password, salt);
	return candidate === storedValue;
};

const parseNumericValue = (value: unknown) => {
	if (value === null || value === undefined || value === '') {
		return null;
	}

	const parsedValue = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsedValue) ? parsedValue : null;
};

const readAgentSyncPayload = async (c: any): Promise<AgentSyncPayload> => {
	if (c.req.method !== 'POST') {
		return { cpuLoad: null, activeConnections: null };
	}

	try {
		const body = await c.req.json();
		return {
			cpuLoad: parseNumericValue(body.cpuLoad ?? body.load),
			activeConnections: parseNumericValue(body.activeConnections),
		};
	} catch {
		return { cpuLoad: null, activeConnections: null };
	}
};

// --- Types & Bindings ---
// c.env.DB is the D1 database binding

// --- Middleware: Authentication ---
const authenticateToken = async (c: any, next: any) => {
	const authHeader = c.req.header('Authorization');
	const token = authHeader && authHeader.split(' ')[1];

	if (!token) return c.json({ error: 'Unauthorized' }, 401);

	try {
		const isValid = await jwt.verify(token, requireSecret(c, 'JWT_SECRET'));
		if (!isValid) throw new Error('Invalid token');

		const { payload } = await jwt.decode(token);
		c.set('user', payload);
		await next();
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('Missing required secret:')) {
			return c.json({ error: err.message }, 500);
		}
		return c.json({ error: 'Forbidden' }, 403);
	}
};

// --- Routes: User Portal ---

app.post('/api/signup', async (c: any) => {
	const { email, password } = await c.req.json();
	if (!email || !password) return c.json({ error: "Email and password required" }, 400);

	const passwordHash = await hashPassword(password);
	const userId = uuidv4();

	try {
		await c.env.DB.prepare(
			`INSERT INTO Users (id, email, passwordHash) VALUES (?, ?, ?)`
		).bind(userId, email, passwordHash).run();

		return c.json({ message: "User created successfully", userId });
	} catch (error) {
		return c.json({ error: "User already exists or database error" }, 500);
	}
});

app.post('/api/login', async (c: any) => {
	const { email, password } = await c.req.json();

	const user = await c.env.DB.prepare(
		`SELECT id, email, passwordHash, tier, subscriptionPlan, isActive FROM Users WHERE email = ?`
	).bind(email).first();

	if (!user) {
		return c.json({ error: "Invalid credentials" }, 401);
	}

	if (!user.isActive) {
		return c.json({ error: "Account is blocked" }, 403);
	}

	let passwordValid = await verifyPassword(password, user.passwordHash);
	if (!passwordValid && !user.passwordHash.startsWith(HASH_SCHEME_PREFIX)) {
		passwordValid = user.passwordHash === password;
		if (passwordValid) {
			const upgradedHash = await hashPassword(password);
			await c.env.DB.prepare(`UPDATE Users SET passwordHash = ? WHERE id = ?`).bind(upgradedHash, user.id).run();
		}
	}

	if (!passwordValid) {
		return c.json({ error: "Invalid credentials" }, 401);
	}

	let accessToken: string;
	try {
		const planId = resolvePlanId(user.subscriptionPlan, user.tier);
		accessToken = await jwt.sign({ id: user.id, email: user.email, tier: planId }, requireSecret(c, 'JWT_SECRET'));
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('Missing required secret:')) {
			return c.json({ error: err.message }, 500);
		}
		throw err;
	}
	return c.json({ accessToken });
});

app.get('/api/plans', async (c: any) => {
	return c.json({
		plans: PLAN_ORDER.map((planId) => ({
			...getPlanDefinition(planId),
		})),
	});
});

app.get('/api/me', authenticateToken, async (c: any) => {
	const user = c.get('user');
	const currentUser = await c.env.DB.prepare(
		`SELECT id, email, tier, subscriptionPlan, bandwidthLimitMbps, creditBalance, isActive, subscriptionEndDate,
		        currentUsagePeriodStart, currentPeriodBytesUsed
		 FROM Users WHERE id = ?`
	).bind(user.id).first();

	if (!currentUser) {
		return c.json({ error: 'User not found' }, 404);
	}

	if (!currentUser.isActive) {
		return c.json({ error: 'Account is blocked' }, 403);
	}

	const planId = resolvePlanId(currentUser.subscriptionPlan, currentUser.tier);
	const activePlan = getPlanDefinition(planId);
	const currentPeriodBytesUsed = getCurrentPeriodBytesUsed(
		currentUser.currentUsagePeriodStart,
		currentUser.currentPeriodBytesUsed,
	);
	const quotaExceeded = isQuotaExceeded(planId, currentPeriodBytesUsed);
	const remainingTrafficBytes = Math.max(0, getPlanMonthlyQuotaBytes(planId) - currentPeriodBytesUsed);

	return c.json({
		user: {
			id: currentUser.id,
			email: currentUser.email,
			tier: planId,
			subscriptionPlan: planId,
			bandwidthLimitMbps: activePlan.bandwidthLimitMbps,
			monthlyTrafficLimitGb: activePlan.monthlyTrafficLimitGb,
			deviceLimit: activePlan.deviceLimit,
			creditBalance: currentUser.creditBalance ?? 0,
			subscriptionEndDate: currentUser.subscriptionEndDate ?? null,
			currentPeriodBytesUsed,
			currentPeriodUsageGb: bytesToGb(currentPeriodBytesUsed),
			remainingTrafficBytes,
			remainingTrafficGb: bytesToGb(remainingTrafficBytes),
			quotaExceeded,
		},
	});
});

app.get('/api/subscription', authenticateToken, async (c: any) => {
	const user = c.get('user');
	const currentUser = await c.env.DB.prepare(
		`SELECT id, tier, subscriptionPlan, bandwidthLimitMbps, isActive, currentUsagePeriodStart, currentPeriodBytesUsed
		 FROM Users WHERE id = ?`
	).bind(user.id).first();

	if (!currentUser) {
		return c.json({ error: 'User not found' }, 404);
	}

	if (!currentUser.isActive) {
		return c.json({ error: 'Account is blocked' }, 403);
	}

	const planId = resolvePlanId(currentUser.subscriptionPlan, currentUser.tier);
	const activePlan = getPlanDefinition(planId);
	const effectiveBandwidthLimit = activePlan.bandwidthLimitMbps;
	const currentPeriodBytesUsed = getCurrentPeriodBytesUsed(
		currentUser.currentUsagePeriodStart,
		currentUser.currentPeriodBytesUsed,
	);

	if (isQuotaExceeded(planId, currentPeriodBytesUsed)) {
		return c.json({ error: 'Monthly traffic quota exceeded. Upgrade or wait for the next monthly reset.' }, 403);
	}

	// 1. Fetch user allocation
	let allocation = await c.env.DB.prepare(
		`SELECT a.xrayUuid, a.port, a.speedLimitMbps, n.publicIp, d.domainName 
     FROM UserAllocations a
     JOIN Nodes n ON a.nodeId = n.id
     JOIN Domains d ON d.status = 'active'
     WHERE a.userId = ? LIMIT 1`
	).bind(user.id).first();

	// 2. If no allocation exists, allocate them to the least busy node
	if (!allocation) {
		const bestNode = await c.env.DB.prepare(
			`SELECT id, publicIp FROM Nodes WHERE status = 'active' ORDER BY activeConnections ASC LIMIT 1`
		).first();

		const activeDomain = await c.env.DB.prepare(`SELECT domainName FROM Domains WHERE status = 'active' LIMIT 1`).first();

		if (!bestNode || !activeDomain) {
			return c.json({ error: "No active proxy nodes or domains available currently." }, 503);
		}

		const xrayUuid = uuidv4();
		// In a real app we'd track used ports. For now, pseudo-random port 10000-50000
		const port = Math.floor(Math.random() * 40000) + 10000;
		const speedLimit = effectiveBandwidthLimit;

		await c.env.DB.prepare(
			`INSERT INTO UserAllocations (id, userId, nodeId, xrayUuid, port, speedLimitMbps) VALUES (?, ?, ?, ?, ?, ?)`
		).bind(uuidv4(), currentUser.id, bestNode.id, xrayUuid, port, speedLimit).run();

		// Update active connections count on the node
		await c.env.DB.prepare(`UPDATE Nodes SET activeConnections = activeConnections + 1 WHERE id = ?`).bind(bestNode.id).run();

		allocation = { xrayUuid, port, speedLimitMbps: speedLimit, publicIp: bestNode.publicIp, domainName: activeDomain.domainName };
	} else if (allocation.speedLimitMbps !== effectiveBandwidthLimit) {
		await c.env.DB.prepare(
			`UPDATE UserAllocations SET speedLimitMbps = ? WHERE userId = ?`
		).bind(effectiveBandwidthLimit, currentUser.id).run();
		allocation = { ...allocation, speedLimitMbps: effectiveBandwidthLimit };
	}

	// 3. Generate VLESS/VMESS Link
	// VLESS clients authenticate by UUID, so the WebSocket path stays fixed across users.
	let sessionToken: string;
	try {
		sessionToken = await signProxySessionToken(c, {
			userId: currentUser.id,
			planId,
			xrayUuid: allocation.xrayUuid,
			issuedAt: Date.now(),
		});
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('Missing required secret:')) {
			return c.json({ error: err.message }, 500);
		}
		throw err;
	}

	const websocketPath = encodeURIComponent(`/sp-ws/${sessionToken}`);
	const vlessLink = `vless://${allocation.xrayUuid}@${allocation.domainName}:443?encryption=none&security=tls&type=ws&host=${allocation.domainName}&path=${websocketPath}`;

	// Base64 encode the link for standard subscription clients
	const base64Encoded = encodeBase64(vlessLink);

	return c.json({
		message: "Subscription active.",
		nodeIP: allocation.publicIp,
		connectionPort: 443,
		speedLimitMbps: allocation.speedLimitMbps,
		planId,
		vlessLink,
		subscriptionUrlData: base64Encoded
	});
});

// --- Routes: Node Polling Agent API ---
// Nodes pull config and optionally push current health stats in the same request.
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

app.get('/api/agent/config', handleAgentConfigSync);
app.post('/api/agent/config', handleAgentConfigSync);

app.post('/api/usage/report', async (c: any) => {
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

	if (typeof body.userId !== 'string' || !body.userId.trim()) {
		return c.json({ error: 'userId is required' }, 400);
	}

	const bytesUsed = normalizeUsageBytes(body.bytesUsed);
	if (bytesUsed <= 0) {
		return c.json({ error: 'bytesUsed must be greater than zero' }, 400);
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

// ... (payment processing endpoint)
app.post('/api/payments/process', authenticateToken, async (c: any) => {
	const currentUser = c.get('user');
	const { amount, currency, paymentMethod, packageId } = await c.req.json();

	if (!packageId) {
		return c.json({ error: 'Missing required payment fields' }, 400);
	}

	const paymentId = uuidv4();
	const selectedPackage = getPackageSelection(packageId);
	if (!selectedPackage) {
		return c.json({ error: 'Unsupported packageId' }, 400);
	}

	const activePlan = getPlanDefinition(selectedPackage.planId);
	const normalizedAmount = parseNumericValue(amount) ?? 0;
	if (Math.abs(normalizedAmount - selectedPackage.expectedAmount) > 0.01) {
		return c.json({ error: 'Invalid amount for selected package' }, 400);
	}

	try {
		// 1. Get the current user to find their existing subscription end date
		const userRecord = await c.env.DB.prepare(
			`SELECT id, subscriptionEndDate, isActive FROM Users WHERE id = ?`
		).bind(currentUser.id).first();

		if (!userRecord) {
			return c.json({ error: 'User not found' }, 404);
		}

		if (!userRecord.isActive) {
			return c.json({ error: 'Account is blocked' }, 403);
		}

		// 2. Calculate the new expiration date
		// If they already have an active sub, add to it. Otherwise, start from today.
		let baseDate = new Date();
		if (userRecord.subscriptionEndDate) {
			const existingEnd = new Date(userRecord.subscriptionEndDate);
			if (existingEnd > baseDate) {
				baseDate = existingEnd;
			}
		}

		let newEndDate: string | null = null;
		if (selectedPackage.monthsToAdd) {
			baseDate.setMonth(baseDate.getMonth() + selectedPackage.monthsToAdd);
			newEndDate = baseDate.toISOString();
		}

		// 3. Insert the payment record and update the user in a batch
		const insertPayment = c.env.DB.prepare(
			`INSERT INTO Payments (id, userId, amount, currency, status, paymentMethod, packageId) 
			 VALUES (?, ?, ?, ?, 'completed', ?, ?)`
		).bind(paymentId, userRecord.id, normalizedAmount, currency || 'USD', paymentMethod, packageId);

		const updateUser = c.env.DB.prepare(
			`UPDATE Users 
             SET tier = ?, 
                 subscriptionPlan = ?, 
                 subscriptionEndDate = ?,
                 bandwidthLimitMbps = ?
             WHERE id = ?`
		).bind(selectedPackage.planId, selectedPackage.planId, newEndDate, activePlan.bandwidthLimitMbps, userRecord.id);

		const updateAllocations = c.env.DB.prepare(
			`UPDATE UserAllocations SET speedLimitMbps = ? WHERE userId = ?`
		).bind(activePlan.bandwidthLimitMbps, userRecord.id);

		await c.env.DB.batch([insertPayment, updateUser, updateAllocations]);

		return c.json({
			success: true,
			paymentId,
			newSubscriptionEnd: newEndDate,
			user: {
				tier: selectedPackage.planId,
				subscriptionPlan: selectedPackage.planId,
				bandwidthLimitMbps: activePlan.bandwidthLimitMbps,
				monthlyTrafficLimitGb: activePlan.monthlyTrafficLimitGb,
				deviceLimit: activePlan.deviceLimit,
			}
		});
	} catch (e: any) {
		return c.json({ error: 'Payment processing failed', details: e.message }, 500);
	}
});

// --- Routes: Admin API ---
const authenticateAdmin = async (c: any, next: any) => {
	try {
		const accessEmail = c.req.header('CF-Access-Authenticated-User-Email')?.trim();
		const accessJwt = c.req.header('CF-Access-Jwt-Assertion');
		if (!accessEmail || !accessJwt) {
			return c.json({ error: 'Cloudflare Access authentication required' }, 401);
		}

		const decodedAccessJwt = jwt.decode<AccessJwtPayload>(accessJwt);
		const algorithm = decodedAccessJwt.header.alg;
		const keyId = (decodedAccessJwt.header as { kid?: string }).kid;
		if (!algorithm || !keyId) {
			return c.json({ error: 'Invalid Cloudflare Access token header' }, 401);
		}

		const signingKeys = await getAccessJwks(c);
		const signingKey = signingKeys.find((key) => key.kid === keyId);
		if (!signingKey) {
			return c.json({ error: 'Unknown Cloudflare Access signing key' }, 401);
		}

		const verifiedToken = await jwt.verify<AccessJwtPayload>(accessJwt, signingKey, {
			algorithm,
			clockTolerance: 60,
			throwError: true,
		});
		if (!verifiedToken) {
			return c.json({ error: 'Invalid Cloudflare Access token' }, 401);
		}

		const expectedAudience = requireSecret(c, 'CF_ACCESS_AUD');
		const tokenAudiences = Array.isArray(verifiedToken.payload.aud)
			? verifiedToken.payload.aud
			: verifiedToken.payload.aud
				? [verifiedToken.payload.aud]
				: [];
		if (!tokenAudiences.includes(expectedAudience)) {
			return c.json({ error: 'Cloudflare Access audience mismatch' }, 403);
		}

		if (verifiedToken.payload.email && verifiedToken.payload.email.toLowerCase() !== accessEmail.toLowerCase()) {
			return c.json({ error: 'Cloudflare Access identity mismatch' }, 403);
		}

		const allowedAdminEmails = getAllowedAdminEmails(c);
		if (allowedAdminEmails && !allowedAdminEmails.has(accessEmail.toLowerCase())) {
			return c.json({ error: 'Admin access denied' }, 403);
		}

		c.set('admin', {
			email: accessEmail,
			subject: verifiedToken.payload.sub ?? null,
		});
		await next();
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('Missing required secret:')) {
			return c.json({ error: err.message }, 500);
		}
		console.error('Cloudflare Access validation failed', err);
		return c.json({ error: 'Cloudflare Access validation failed' }, 403);
	}
};

app.get('/api/admin/session', authenticateAdmin, async (c: any) => {
	return c.json({ admin: c.get('admin') });
});

app.get('/api/admin/users', authenticateAdmin, async (c: any) => {
	// Query to get all users and their currently mapped proxy node info
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

app.get('/api/admin/users/:id/payments', authenticateAdmin, async (c: any) => {
	const userId = c.req.param('id');
	const { results: payments } = await c.env.DB.prepare(
		`SELECT id, amount, currency, status, paymentMethod, createdAt 
		 FROM Payments 
		 WHERE userId = ? 
		 ORDER BY createdAt DESC LIMIT 10`
	).bind(userId).all();
	return c.json({ payments });
});

app.post('/api/admin/users/:id/block', authenticateAdmin, async (c: any) => {
	const userId = c.req.param('id');
	const { block } = await c.req.json(); // boolean: true to block, false to unblock

	const newIsActive = block ? 0 : 1;

	// Update user status
	await c.env.DB.prepare(`UPDATE Users SET isActive = ? WHERE id = ?`).bind(newIsActive, userId).run();

	// If blocking, we might also want to delete their active allocations so they are kicked off the node immediately during the next sync
	if (block) {
		await c.env.DB.prepare(`DELETE FROM UserAllocations WHERE userId = ?`).bind(userId).run();
	}

	return c.json({ message: `User ${userId} isActive updated to ${newIsActive}` });
});

app.get('/api/admin/nodes', authenticateAdmin, async (c: any) => {
	// List all proxy nodes and count how many active user allocations are currently mapped to each node
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

app.post('/api/admin/nodes', authenticateAdmin, async (c: any) => {
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

// --- Cron Trigger: Health Monitor & Failover ---
export default {
	fetch: app.fetch,

	async scheduled(event: any, env: any, ctx: any) {
		ctx.waitUntil(runHealthCheck(env));
	},
};

async function runHealthCheck(env: any) {
	// 1. Fetch the currently active domain
	const activeDomain = await env.DB.prepare(`SELECT id, domainName FROM Domains WHERE status = 'active' LIMIT 1`).first();
	if (!activeDomain) return; // Nothing to monitor

	// 2. Perform a simple HTTP/WebSocket reachability test
	// If the domain is blocked by GFW, this will timeout or reset from typical restricted regions.
	// In a real scenario, this ping should originate from a VPS located inside the restricted region.
	// For this prototype, we'll try a generic fetch.
	try {
		const start = Date.now();
		const res = await fetch(`https://${activeDomain.domainName}/health`, {
			method: 'GET',
			headers: { 'X-Health-Check': env.AGENT_SECRET }
		});

		if (res.ok) {
			console.log(`[Health Monitor] Domain ${activeDomain.domainName} is reachable (${Date.now() - start}ms)`);
			return; // Domain is healthy
		}
		throw new Error(`HTTP ${res.status}`);
	} catch (error) {
		console.error(`[Health Monitor] Domain ${activeDomain.domainName} failed check:`, error);
		await triggerFailover(env, activeDomain);
	}
}

async function triggerFailover(env: any, failedDomain: any) {
	console.log(`[Failover] Initiating failover for blocked domain: ${failedDomain.domainName}`);

	// Mark the failed domain as blocked
	await env.DB.prepare(`UPDATE Domains SET status = 'blocked' WHERE id = ?`).bind(failedDomain.id).run();

	// Find a standby domain
	const standbyDomain = await env.DB.prepare(`SELECT id, domainName, cloudflareZoneId FROM Domains WHERE status = 'standby' LIMIT 1`).first();

	if (!standbyDomain) {
		console.error(`[Failover] CRITICAL: No standby domains available!`);
		// Alert admin via Telegram/Email in a real system
		return;
	}

	// Activate the standby domain
	await env.DB.prepare(`UPDATE Domains SET status = 'active' WHERE id = ?`).bind(standbyDomain.id).run();
	console.log(`[Failover] Activated standby domain: ${standbyDomain.domainName}`);

	// In a fully automated system, we would also:
	// 1. Use Cloudflare API (fetch to api.cloudflare.com) to update DNS A records for the new domain 
	//    to point to the Cloudflare Worker or the proxy nodes.
	// 2. Update Worker routes.

	// Clients will automatically receive the new domain on their next subscription update pull.
}
