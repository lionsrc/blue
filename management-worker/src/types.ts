export type Bindings = {
    DB: D1Database;
    JWT_SECRET: string;
    AGENT_SECRET: string;
    SESSION_TOKEN_SECRET: string;
    USAGE_REPORT_SECRET: string;
    CF_ACCESS_TEAM_DOMAIN: string;
    CF_ACCESS_AUD: string;
    RESEND_API_KEY: string;
    ADMIN_ALLOW_EMAILS?: string;
    CORS_ALLOW_ORIGINS?: string;
    RESEND_FROM_EMAIL?: string;
};

export type RequiredSecretBinding =
    | 'JWT_SECRET'
    | 'AGENT_SECRET'
    | 'SESSION_TOKEN_SECRET'
    | 'USAGE_REPORT_SECRET'
    | 'CF_ACCESS_TEAM_DOMAIN'
    | 'CF_ACCESS_AUD'
    | 'RESEND_API_KEY';

export type OptionalBinding =
    | 'ADMIN_ALLOW_EMAILS'
    | 'CORS_ALLOW_ORIGINS'
    | 'RESEND_FROM_EMAIL';

export type AccessJwtPayload = {
    aud?: string | string[];
    email?: string;
    sub?: string;
};

export type AgentSyncPayload = {
    cpuLoad: number | null;
    activeConnections: number | null;
};

export type PlanId = 'free' | 'basic' | 'pro';

export type PlanDefinition = {
    id: PlanId;
    monthlyPriceUsd: number;
    bandwidthLimitMbps: number;
    monthlyTrafficLimitGb: number;
    deviceLimit: number | null;
};

export type PackageSelection = {
    planId: PlanId;
    monthsToAdd: number | null;
    expectedAmount: number;
};

export type ProxySessionPayload = {
    userId: string;
    planId: PlanId;
    xrayUuid: string;
    issuedAt: number;
};

export type AccessJwk = JsonWebKey & {
    kid: string;
    alg?: string;
};
