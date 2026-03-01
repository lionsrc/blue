import * as jwt from '@tsndr/cloudflare-worker-jwt';
import type { Bindings, RequiredSecretBinding, OptionalBinding, AccessJwk, AccessJwtPayload, AgentSyncPayload, ProxySessionPayload } from './types.js';

// --- Constants ---
export const LEGACY_HASH_PREFIX = 'sha256';
export const HASH_PREFIX = 'pbkdf2';
export const HASH_SCHEME_PREFIX = `${HASH_PREFIX}:`;
export const LEGACY_HASH_SCHEME_PREFIX = `${LEGACY_HASH_PREFIX}:`;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH_BITS = 256;
export const JWT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

const DEFAULT_CORS_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
];

const ACCESS_CERT_CACHE_TTL_MS = 5 * 60 * 1000;
// Ephemeral cache — persists within an isolate but resets on cold starts.
let accessJwkCache: { teamDomain: string; expiresAt: number; keys: AccessJwk[] } | null = null;

// --- Rate Limiter ---
const rateLimitBuckets = new Map<string, number[]>();

const cleanupRateLimitBucket = (timestamps: number[], windowMs: number, now: number) =>
    timestamps.filter((t) => t > now - windowMs);

export const createRateLimiter = (maxRequests: number, windowSeconds: number) => {
    const windowMs = windowSeconds * 1000;

    return async (c: any, next: any) => {
        const clientIp = c.req.header('CF-Connecting-IP')
            || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
            || 'unknown';
        const bucketKey = `${c.req.path}:${clientIp}`;
        const now = Date.now();

        let timestamps = rateLimitBuckets.get(bucketKey) || [];
        timestamps = cleanupRateLimitBucket(timestamps, windowMs, now);

        if (timestamps.length >= maxRequests) {
            return c.json({ error: 'Too many requests. Please try again later.' }, 429);
        }

        timestamps.push(now);
        rateLimitBuckets.set(bucketKey, timestamps);
        await next();
    };
};

export const authRateLimiter = createRateLimiter(10, 60);
export const paymentRateLimiter = createRateLimiter(20, 60);

/** @internal — clears accumulated rate-limit state; intended for test isolation only. */
export const _resetRateLimitBucketsForTesting = () => rateLimitBuckets.clear();

// --- Binding Helpers ---
export const getOptionalBinding = (c: any, bindingName: OptionalBinding) => {
    return c.env[bindingName]?.trim() || '';
};

export const requireSecret = (c: any, secretName: RequiredSecretBinding) => {
    const value = c.env[secretName];
    if (!value || !value.trim()) {
        throw new Error(`Missing required secret: ${secretName}`);
    }
    return value.trim();
};

export const getAllowedCorsOrigins = (c: any) => {
    const extra = getOptionalBinding(c, 'CORS_ALLOW_ORIGINS');
    const origins = [...DEFAULT_CORS_ORIGINS];
    if (extra) {
        origins.push(...extra.split(',').map((s: string) => s.trim()).filter(Boolean));
    }
    return new Set(origins);
};

export const getAllowedAdminEmails = (c: any) => {
    const raw = getOptionalBinding(c, 'ADMIN_ALLOW_EMAILS');
    if (!raw) return null;
    return new Set(
        raw.split(',')
            .map((s: string) => s.trim().toLowerCase())
            .filter(Boolean)
    );
};

// --- Cloudflare Access ---
export const normalizeAccessTeamDomain = (teamDomain: string) => {
    let domain = teamDomain.trim().toLowerCase();
    if (domain.startsWith('https://')) domain = domain.slice(8);
    if (domain.startsWith('http://')) domain = domain.slice(7);
    if (domain.endsWith('/')) domain = domain.slice(0, -1);
    if (!domain.includes('.')) domain = `${domain}.cloudflareaccess.com`;
    return domain;
};

export const getAccessJwks = async (c: any): Promise<AccessJwk[]> => {
    const teamDomain = normalizeAccessTeamDomain(requireSecret(c, 'CF_ACCESS_TEAM_DOMAIN'));

    if (accessJwkCache && accessJwkCache.teamDomain === teamDomain && Date.now() < accessJwkCache.expiresAt) {
        return accessJwkCache.keys;
    }

    const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
    const response = await fetch(certsUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch Access certificates from ${certsUrl}: ${response.status}`);
    }

    const body = await response.json() as { keys?: AccessJwk[] };
    const keys = body.keys ?? [];

    accessJwkCache = {
        teamDomain,
        expiresAt: Date.now() + ACCESS_CERT_CACHE_TTL_MS,
        keys,
    };

    return keys;
};

// --- Encoding Helpers ---
export const encodeBase64 = (value: string) => btoa(value);
export const encodeBase64Url = (value: string) => (
    btoa(value)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
);

export const encodeBase64UrlBytes = (bytes: Uint8Array) => {
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

// --- Password Hashing ---
const legacyHashPasswordWithSalt = async (password: string, salt: string) => {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return `${LEGACY_HASH_PREFIX}:${salt}:${toHex(digest)}`;
};

const hashPasswordWithPbkdf2 = async (password: string, salt: string) => {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        PBKDF2_KEY_LENGTH_BITS,
    );
    return `${HASH_PREFIX}:${salt}:${toHex(derivedBits)}`;
};

export const hashPassword = async (password: string) => {
    return hashPasswordWithPbkdf2(password, createSalt());
};

export const signProxySessionToken = async (c: any, payload: ProxySessionPayload) => {
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

export const verifyPassword = async (password: string, storedValue: string) => {
    const [prefix, salt, expectedHash] = storedValue.split(':');

    if (prefix === HASH_PREFIX && salt && expectedHash) {
        const candidate = await hashPasswordWithPbkdf2(password, salt);
        return candidate === storedValue;
    }

    if (prefix === LEGACY_HASH_PREFIX && salt && expectedHash) {
        const candidate = await legacyHashPasswordWithSalt(password, salt);
        return candidate === storedValue;
    }

    return false;
};

// --- Misc Helpers ---
export const parseNumericValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
};

export const readAgentSyncPayload = async (c: any): Promise<AgentSyncPayload> => {
    if (c.req.method !== 'POST') {
        return { cpuLoad: null, activeConnections: null };
    }

    try {
        const body = JSON.parse(await c.req.text() || '{}');
        return {
            cpuLoad: parseNumericValue(body.cpuLoad ?? body.load),
            activeConnections: parseNumericValue(body.activeConnections),
        };
    } catch {
        return { cpuLoad: null, activeConnections: null };
    }
};

// --- JWT Middleware ---
export const authenticateToken = async (c: any, next: any) => {
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

// --- Admin Middleware ---
export const authenticateAdmin = async (c: any, next: any) => {
    try {
        // Local Dev Bypass
        if (c.env.ENVIRONMENT === 'development' || !c.env.CF_ACCESS_AUD) {
            c.set('admin', {
                email: 'dev-admin@localhost',
                subject: 'dev-subject-mock',
            });
            await next();
            return;
        }

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

export { jwt };
