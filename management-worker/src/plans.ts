import type { PlanId, PlanDefinition, PackageSelection } from './types.js';

export const BYTES_PER_GB = 1024 * 1024 * 1024;
export const PLAN_ORDER: PlanId[] = ['free', 'basic', 'pro'];

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
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

export const PACKAGE_PLAN_MAP: Record<string, { planId: PlanId; monthsToAdd: number | null }> = {
    free: { planId: 'free', monthsToAdd: null },
    basic: { planId: 'basic', monthsToAdd: 1 },
    basic_monthly: { planId: 'basic', monthsToAdd: 1 },
    pro: { planId: 'pro', monthsToAdd: 1 },
    pro_monthly: { planId: 'pro', monthsToAdd: 1 },
    '1_month_pro': { planId: 'pro', monthsToAdd: 1 },
    '1_year_pro': { planId: 'pro', monthsToAdd: 12 },
    recurring_monthly: { planId: 'pro', monthsToAdd: 1 },
};

export const isPlanId = (value: string): value is PlanId => value in PLAN_DEFINITIONS;

export const resolvePlanId = (subscriptionPlan: unknown, tier: unknown): PlanId => {
    if (typeof subscriptionPlan === 'string' && isPlanId(subscriptionPlan)) {
        return subscriptionPlan;
    }
    if (typeof tier === 'string' && isPlanId(tier)) {
        return tier;
    }
    return 'free';
};

export const getPlanDefinition = (planId: PlanId) => PLAN_DEFINITIONS[planId];

export const getPackageSelection = (packageId: unknown): PackageSelection | null => {
    if (typeof packageId !== 'string') return null;

    const packageKey = packageId.toLowerCase().replace(/\s+/g, '_');
    const mapping = PACKAGE_PLAN_MAP[packageKey];
    if (!mapping) return null;

    const plan = PLAN_DEFINITIONS[mapping.planId];
    return {
        planId: mapping.planId,
        monthsToAdd: mapping.monthsToAdd,
        expectedAmount: plan.monthlyPriceUsd * (mapping.monthsToAdd ?? 0),
    };
};

export const getUsagePeriodStart = (referenceDate = new Date()) => {
    const year = referenceDate.getUTCFullYear();
    const month = referenceDate.getUTCMonth();
    return new Date(Date.UTC(year, month, 1)).toISOString();
};

export const normalizeUsageBytes = (value: unknown) => {
    if (value === null || value === undefined) return 0;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const getCurrentPeriodBytesUsed = (periodStart: unknown, bytesUsed: unknown, referenceDate = new Date()) => {
    const currentPeriodStart = getUsagePeriodStart(referenceDate);
    if (typeof periodStart === 'string' && periodStart === currentPeriodStart) {
        return normalizeUsageBytes(bytesUsed);
    }
    return 0;
};

export const getPlanMonthlyQuotaBytes = (planId: PlanId) => {
    return PLAN_DEFINITIONS[planId].monthlyTrafficLimitGb * BYTES_PER_GB;
};

export const isQuotaExceeded = (planId: PlanId, currentPeriodBytesUsed: number) => {
    return currentPeriodBytesUsed >= getPlanMonthlyQuotaBytes(planId);
};

export const bytesToGb = (bytesUsed: number) => {
    return parseFloat((bytesUsed / BYTES_PER_GB).toFixed(2));
};
