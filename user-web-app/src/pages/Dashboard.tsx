import { useEffect, useRef, useState } from 'react';
import { FiCopy, FiCheckCircle, FiTrendingUp, FiLogOut, FiCreditCard, FiActivity, FiGlobe, FiChevronDown, FiMail, FiLock, FiClock, FiTrash2 } from 'react-icons/fi';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type PlanId = 'free' | 'basic' | 'pro';

type PlanData = {
    id: PlanId;
    monthlyPriceUsd: number;
    bandwidthLimitMbps: number;
    monthlyTrafficLimitGb: number;
    deviceLimit: number | null;
};

type UserProfile = {
    id: string;
    email: string;
    tier: PlanId;
    subscriptionPlan: PlanId;
    bandwidthLimitMbps: number;
    monthlyTrafficLimitGb: number;
    deviceLimit: number | null;
    creditBalance: number;
    subscriptionEndDate: string | null;
};

type SubscriptionData = {
    nodeIP: string;
    connectionPort: number;
    speedLimitMbps: number;
    planId: PlanId;
    vlessLink: string;
    subscriptionUrlData: string;
};

const FALLBACK_PLANS: PlanData[] = [
    {
        id: 'free',
        monthlyPriceUsd: 0,
        bandwidthLimitMbps: 1,
        monthlyTrafficLimitGb: 50,
        deviceLimit: 1,
    },
    {
        id: 'basic',
        monthlyPriceUsd: 18,
        bandwidthLimitMbps: 300,
        monthlyTrafficLimitGb: 200,
        deviceLimit: null,
    },
    {
        id: 'pro',
        monthlyPriceUsd: 38,
        bandwidthLimitMbps: 600,
        monthlyTrafficLimitGb: 500,
        deviceLimit: null,
    },
];

const readJson = async (response: Response) => {
    try {
        return await response.json();
    } catch {
        return {};
    }
};

export default function Dashboard() {
    const [copied, setCopied] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [plans, setPlans] = useState<PlanData[]>(FALLBACK_PLANS);
    const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingError, setLoadingError] = useState('');
    const [subscriptionError, setSubscriptionError] = useState('');
    const [purchaseError, setPurchaseError] = useState('');
    const [purchaseInFlight, setPurchaseInFlight] = useState<PlanId | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const plansRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const { t } = useTranslation();
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787';

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadDashboard = async () => {
            const token = localStorage.getItem('token');
            if (!token) {
                navigate('/login', { replace: true });
                return;
            }

            setIsLoading(true);
            setLoadingError('');
            setSubscriptionError('');

            const authHeaders = {
                Authorization: `Bearer ${token}`,
            };

            try {
                const [plansResponse, userResponse, subscriptionResponse] = await Promise.all([
                    fetch(`${apiUrl}/api/plans`),
                    fetch(`${apiUrl}/api/me`, { headers: authHeaders }),
                    fetch(`${apiUrl}/api/subscription`, { headers: authHeaders }),
                ]);

                const plansData = await readJson(plansResponse) as { plans?: PlanData[] };
                const userData = await readJson(userResponse) as { user?: UserProfile; error?: string };
                const subscriptionData = await readJson(subscriptionResponse) as SubscriptionData & { error?: string };

                if (cancelled) {
                    return;
                }

                if (plansResponse.ok && Array.isArray(plansData.plans) && plansData.plans.length > 0) {
                    setPlans(plansData.plans);
                }

                if (!userResponse.ok || !userData.user) {
                    if (userResponse.status === 401 || userResponse.status === 403) {
                        localStorage.removeItem('token');
                        navigate('/login', { replace: true });
                        return;
                    }

                    throw new Error(userData.error || t('dashboard.loadError'));
                }

                setUser(userData.user);

                if (subscriptionResponse.ok) {
                    setSubscription(subscriptionData);
                } else {
                    setSubscription(null);
                    setSubscriptionError(subscriptionData.error || t('dashboard.subscriptionUnavailable'));
                }
            } catch (err) {
                if (cancelled) {
                    return;
                }

                setLoadingError(err instanceof Error ? err.message : t('dashboard.loadError'));
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void loadDashboard();

        return () => {
            cancelled = true;
        };
    }, [apiUrl, navigate, t]);

    const handleCopy = () => {
        if (!subscription?.subscriptionUrlData) {
            return;
        }

        navigator.clipboard.writeText(subscription.subscriptionUrlData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        navigate('/login');
    };

    const handleBrowsePlans = () => {
        plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleSelectPlan = async (planId: PlanId) => {
        if (!user || purchaseInFlight) {
            return;
        }

        if (planId === user.subscriptionPlan) {
            return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login', { replace: true });
            return;
        }

        const selectedPlan = plans.find((plan) => plan.id === planId);
        if (!selectedPlan) {
            return;
        }

        setPurchaseError('');
        setPurchaseInFlight(planId);

        try {
            const paymentResponse = await fetch(`${apiUrl}/api/payments/process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    amount: selectedPlan.monthlyPriceUsd,
                    currency: 'USD',
                    paymentMethod: selectedPlan.monthlyPriceUsd > 0 ? 'card' : 'plan-switch',
                    packageId: planId,
                }),
            });

            const paymentData = await readJson(paymentResponse) as {
                error?: string;
                user?: Pick<UserProfile, 'tier' | 'subscriptionPlan' | 'bandwidthLimitMbps' | 'monthlyTrafficLimitGb' | 'deviceLimit'>;
            };

            if (!paymentResponse.ok || !paymentData.user) {
                if (paymentResponse.status === 401 || paymentResponse.status === 403) {
                    localStorage.removeItem('token');
                    navigate('/login', { replace: true });
                    return;
                }

                throw new Error(paymentData.error || t('dashboard.purchaseFailed'));
            }

            setUser((currentUser) => (
                currentUser
                    ? {
                        ...currentUser,
                        ...paymentData.user,
                    }
                    : currentUser
            ));

            const subscriptionResponse = await fetch(`${apiUrl}/api/subscription`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const subscriptionData = await readJson(subscriptionResponse) as SubscriptionData & { error?: string };

            if (subscriptionResponse.ok) {
                setSubscription(subscriptionData);
                setSubscriptionError('');
            } else {
                setSubscription(null);
                setSubscriptionError(subscriptionData.error || t('dashboard.subscriptionUnavailable'));
            }
        } catch (err) {
            setPurchaseError(err instanceof Error ? err.message : t('dashboard.purchaseFailed'));
        } finally {
            setPurchaseInFlight(null);
        }
    };

    const formatPlanPrice = (plan: PlanData) => (
        plan.monthlyPriceUsd === 0
            ? t('dashboard.planPrices.free')
            : t('dashboard.planPriceMonthly', { price: plan.monthlyPriceUsd })
    );

    const formatDeviceLimit = (deviceLimit: number | null) => (
        deviceLimit === null
            ? t('dashboard.unlimitedDevices')
            : t('dashboard.singleDeviceCount', { count: deviceLimit })
    );

    const getPlanCta = (planId: PlanId, isCurrentPlan: boolean) => {
        if (isCurrentPlan) {
            return t('dashboard.planCtas.current');
        }

        if (planId === 'free') {
            return t('dashboard.planCtas.free');
        }

        if (planId === 'basic') {
            return t('dashboard.planCtas.basic');
        }

        return t('dashboard.planCtas.pro');
    };

    const activePlanLabels: Record<PlanId, string> = {
        free: t('dashboard.planNames.free'),
        basic: t('dashboard.planNames.basic'),
        pro: t('dashboard.planNames.pro'),
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-slate-200 flex items-center justify-center font-sans">
                <div className="rounded-3xl border border-white/10 bg-white/5 px-8 py-6 text-center backdrop-blur-xl">
                    <div className="mx-auto mb-4 h-12 w-12 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 flex items-center justify-center text-emerald-300">
                        <FiActivity />
                    </div>
                    <p className="text-white font-semibold">{t('dashboard.loading')}</p>
                    <p className="text-sm text-slate-400 mt-2">{t('dashboard.loadingHint')}</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-slate-200 flex items-center justify-center font-sans px-6">
                <div className="max-w-xl rounded-3xl border border-red-500/20 bg-red-500/10 px-8 py-7 backdrop-blur-xl">
                    <h1 className="text-2xl font-black text-white mb-3">{t('dashboard.loadErrorTitle')}</h1>
                    <p className="text-red-200">{loadingError || t('dashboard.loadError')}</p>
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="mt-6 rounded-xl bg-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/15"
                    >
                        {t('login.signIn')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-slate-200 relative overflow-hidden font-sans">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />

            <nav className="relative z-50 border-b border-white/10 bg-white/5 backdrop-blur-md px-8 py-5 flex justify-between items-center transition-all duration-300">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-blue-500/30">
                        BL
                    </div>
                    <span className="font-extrabold text-2xl tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">Blue Lotus Network</span>
                </div>
                <div className="flex items-center space-x-8">
                    <div className="hidden sm:flex items-center space-x-2 bg-white/5 px-4 py-2 rounded-full border border-white/10">
                        <div className={`w-2 h-2 rounded-full ${subscription ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                        <span className={`text-sm font-medium ${subscription ? 'text-emerald-400' : 'text-amber-300'}`}>
                            {subscription ? t('nav.networkActive') : t('dashboard.awaitingNode')}
                        </span>
                    </div>

                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            onClick={() => setMenuOpen(!menuOpen)}
                            className="flex items-center space-x-2 text-slate-300 hover:text-white transition-colors py-2"
                        >
                            <span>{user.email}</span>
                            <FiChevronDown className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {menuOpen && (
                            <div className="absolute right-0 mt-4 w-56 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-2 z-50 overflow-hidden backdrop-blur-xl">
                                <Link to="/change-email" className="flex items-center px-4 py-2.5 text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                                    <FiMail className="mr-3 text-slate-400" /> {t('nav.changeEmail')}
                                </Link>
                                <Link to="/change-password" className="flex items-center px-4 py-2.5 text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                                    <FiLock className="mr-3 text-slate-400" /> {t('nav.changePassword')}
                                </Link>
                                <Link to="/history" className="flex items-center px-4 py-2.5 text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                                    <FiClock className="mr-3 text-slate-400" /> {t('nav.paymentHistory')}
                                </Link>
                                <div className="h-px bg-white/10 my-1"></div>
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="w-full flex items-center px-4 py-2.5 text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                                >
                                    <FiLogOut className="mr-3 text-slate-400" /> {t('nav.logout')}
                                </button>
                                <div className="h-px bg-white/10 my-1"></div>
                                <Link to="/delete-account" className="flex items-center px-4 py-2.5 text-red-400 hover:bg-red-500/10 transition-colors">
                                    <FiTrash2 className="mr-3" /> {t('nav.deleteAccount')}
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </nav>

            <main className="relative z-10 max-w-6xl mx-auto px-6 py-12 space-y-8">
                <div className="mb-10">
                    <h1 className="text-4xl font-extrabold text-white mb-2">{t('dashboard.welcome')}</h1>
                    <p className="text-slate-400 text-lg">{t('dashboard.manageAccess')}</p>
                </div>

                {loadingError && (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-red-200">
                        {loadingError}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl relative overflow-hidden group hover:border-white/20 transition-all duration-300 transform hover:-translate-y-1">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all duration-500" />
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-4">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t('dashboard.activePlan')}</p>
                                <div className={`p-2 rounded-lg ${user.subscriptionPlan === 'free' ? 'bg-slate-800 text-slate-300' : 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-400 border border-indigo-500/30'}`}>
                                    <FiTrendingUp size={20} />
                                </div>
                            </div>
                            <h3 className="text-3xl font-black text-white flex items-center mb-2">
                                {activePlanLabels[user.subscriptionPlan]}
                            </h3>
                            <p className="text-slate-400 flex items-center">
                                <FiActivity className="mr-2 text-indigo-400" />
                                {t('dashboard.dataSpeed', { speed: user.bandwidthLimitMbps })}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl flex items-center justify-between md:col-span-2 group hover:border-white/20 transition-all duration-300 transform hover:-translate-y-1 overflow-hidden relative">
                        <div className="absolute top-[-50%] right-[-10%] w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all duration-500" />
                        <div className="relative z-10">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{t('dashboard.monthlyTraffic')}</p>
                            <h3 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300 mb-2">
                                {t('dashboard.trafficAllowance', { traffic: user.monthlyTrafficLimitGb })}
                            </h3>
                            <p className="text-slate-400">
                                {user.deviceLimit === null
                                    ? t('dashboard.paidUsageNote')
                                    : t('dashboard.freeUsageNote', { devices: user.deviceLimit })}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleBrowsePlans}
                            className="relative z-10 px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-xl font-bold transition-all duration-300 shadow-lg shadow-emerald-500/25 flex items-center transform hover:scale-105 active:scale-95"
                        >
                            <FiCreditCard className="mr-3 text-xl" />
                            {t('dashboard.viewPlans')}
                        </button>
                    </div>
                </div>

                <section ref={plansRef} className="scroll-mt-24 space-y-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.3em] text-blue-300/80 mb-3">{t('dashboard.planEyebrow')}</p>
                            <h2 className="text-3xl font-black text-white mb-2">{t('dashboard.planSectionTitle')}</h2>
                            <p className="text-slate-400 max-w-3xl">{t('dashboard.planSectionSubtitle')}</p>
                        </div>
                        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-sm font-medium text-emerald-200 max-w-sm">
                            {t('dashboard.freeMainPoint')}
                        </div>
                    </div>

                    {purchaseError && (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-red-200">
                            {purchaseError}
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {plans.map((plan) => {
                            const isCurrentPlan = user.subscriptionPlan === plan.id;
                            const isProcessing = purchaseInFlight === plan.id;

                            return (
                                <div
                                    key={plan.id}
                                    className={`relative rounded-2xl p-8 border shadow-2xl backdrop-blur-xl overflow-hidden transition-all duration-300 hover:-translate-y-1 ${plan.id === 'free' ? 'bg-gradient-to-br from-emerald-500/10 via-white/5 to-blue-500/10 border-emerald-400/30' : 'bg-white/5 border-white/10 hover:border-white/20'}`}
                                >
                                    {plan.id === 'free' && (
                                        <div className="absolute top-5 right-5 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-200">
                                            {t('dashboard.recommended')}
                                        </div>
                                    )}

                                    <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">
                                        {t(`dashboard.planHighlights.${plan.id}`)}
                                    </p>
                                    <div className="mt-5 mb-7">
                                        <h3 className="text-3xl font-black text-white mb-2">{activePlanLabels[plan.id]}</h3>
                                        <p className="text-2xl font-extrabold text-blue-300">{formatPlanPrice(plan)}</p>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                                            <span className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-1">{t('dashboard.devicesLabel')}</span>
                                            <span className="text-slate-200 font-semibold">{formatDeviceLimit(plan.deviceLimit)}</span>
                                        </div>
                                        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                                            <span className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-1">{t('dashboard.speedLabel')}</span>
                                            <span className="text-slate-200 font-semibold">{plan.bandwidthLimitMbps} Mbps</span>
                                        </div>
                                        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                                            <span className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-1">{t('dashboard.trafficLabel')}</span>
                                            <span className="text-slate-200 font-semibold">{t('dashboard.trafficAllowance', { traffic: plan.monthlyTrafficLimitGb })}</span>
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        disabled={isCurrentPlan || purchaseInFlight !== null}
                                        onClick={() => void handleSelectPlan(plan.id)}
                                        className={`mt-8 w-full rounded-xl px-5 py-3 font-bold transition-all duration-300 ${isCurrentPlan ? 'border border-emerald-300/30 bg-emerald-400/15 text-emerald-200' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/20'} ${purchaseInFlight !== null && !isCurrentPlan ? 'opacity-70 cursor-not-allowed' : ''}`}
                                    >
                                        {isProcessing ? t('dashboard.processingPlan') : getPlanCta(plan.id, isCurrentPlan)}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden mt-12 hover:border-white/20 transition-all duration-300">
                    <div className="border-b border-white/10 px-8 py-6 bg-white/[0.02]">
                        <h2 className="text-2xl font-bold text-white mb-1 flex items-center">
                            <FiGlobe className="mr-3 text-blue-400" />
                            {t('dashboard.subConfig')}
                        </h2>
                        <p className="text-slate-400 text-sm ml-9">{t('dashboard.importUrl')}</p>
                    </div>

                    <div className="p-8">
                        {subscriptionError && (
                            <div className="mb-6 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                                {subscriptionError}
                            </div>
                        )}

                        <div className="group relative rounded-xl border border-white/10 bg-black/40 overflow-hidden flex items-stretch focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/50 transition-all duration-300 mb-10">
                            <input
                                type="text"
                                readOnly
                                value={subscription?.subscriptionUrlData || ''}
                                className="w-full bg-transparent py-4 px-6 text-slate-300 font-mono text-sm focus:outline-none placeholder-slate-600 selection:bg-blue-500/30"
                            />
                            <div className="p-2">
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    disabled={!subscription}
                                    className={`h-full flex items-center justify-center px-8 rounded-lg font-bold transition-all duration-300 ${copied ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'} ${!subscription ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                    {copied ? (
                                        <>
                                            <FiCheckCircle size={20} className="mr-2" /> {t('dashboard.copied')}
                                        </>
                                    ) : (
                                        <>
                                            <FiCopy size={20} className="mr-2 group-hover:scale-110 duration-200" /> {t('dashboard.copyLink')}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6 ml-1">{t('dashboard.liveMetrics')}</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {[
                                    { label: t('dashboard.assignedNode'), value: subscription?.nodeIP || t('dashboard.notConnected'), color: 'text-blue-400' },
                                    { label: t('dashboard.protocol'), value: 'VLESS / WebSocket', color: 'text-purple-400' },
                                    { label: t('dashboard.assignedPort'), value: subscription ? String(subscription.connectionPort) : '--', color: 'text-indigo-400' },
                                    { label: t('dashboard.nodeStatus'), value: subscription ? t('dashboard.nodeReady') : t('dashboard.awaitingNode'), color: subscription ? 'text-emerald-400' : 'text-amber-300', isStatus: true }
                                ].map((item, index) => (
                                    <div key={index} className="bg-white/5 border border-white/5 rounded-xl p-5 hover:bg-white/10 transition-colors duration-300">
                                        <span className="block text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">{item.label}</span>
                                        <span className={`font-semibold ${item.color} flex items-center`}>
                                            {item.isStatus && <span className={`w-2 h-2 rounded-full mr-2 ${subscription ? 'bg-emerald-400 animate-pulse' : 'bg-amber-300'}`}></span>}
                                            {item.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
