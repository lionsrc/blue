import { Link } from 'react-router-dom';
import { FiActivity, FiArrowRight, FiGlobe, FiLayers, FiShield, FiZap } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';

const featureIcons = [FiZap, FiGlobe, FiShield, FiLayers];

export default function Home() {
    const { t } = useTranslation();

    const features = t('landing.features', { returnObjects: true }) as Array<{
        title: string;
        description: string;
    }>;
    const stats = t('landing.stats', { returnObjects: true }) as Array<{
        value: string;
        label: string;
    }>;
    const steps = t('landing.steps', { returnObjects: true }) as string[];
    const freeNoticeTitle = t('landing.freeNoticeTitle');
    const freeNoticeBody = t('landing.freeNoticeBody');

    return (
        <div className="min-h-screen bg-[#07111a] text-slate-100 overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-x-0 top-0 h-[540px] bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.16),_transparent_38%),radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_34%),linear-gradient(180deg,_rgba(6,18,33,0.96),_rgba(7,17,26,1))]" />
                <div className="absolute left-[-8%] top-40 h-72 w-72 rounded-full border border-emerald-400/10 bg-emerald-400/5 blur-3xl" />
                <div className="absolute right-[-10%] top-28 h-80 w-80 rounded-full border border-cyan-400/10 bg-cyan-400/5 blur-3xl" />
            </div>

            <header className="relative z-10 border-b border-white/5">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 md:px-8">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-lg font-black text-slate-950 shadow-lg shadow-emerald-500/20">
                            BL
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-300/80">{t('landing.brandBadge')}</p>
                            <h1 className="text-lg font-black tracking-tight text-white">{t('landing.brand')}</h1>
                        </div>
                    </div>

                    <div className="hidden items-center gap-3 md:flex">
                        <Link
                            to="/login"
                            className="rounded-full border border-white/10 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/30 hover:text-white"
                        >
                            {t('landing.login')}
                        </Link>
                        <Link
                            to="/register"
                            className="rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:brightness-110"
                        >
                            {t('landing.register')}
                        </Link>
                    </div>
                </div>
            </header>

            <main className="relative z-10">
                <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-12 md:grid-cols-[1.05fr_0.95fr] md:px-8 md:pb-24 md:pt-20">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/10 px-4 py-2 text-xs font-semibold tracking-[0.26em] text-emerald-200">
                            <FiActivity />
                            {t('landing.ribbon')}
                        </div>

                        <h2 className="mt-6 max-w-3xl text-5xl font-black leading-[1.02] tracking-tight text-white md:text-7xl">
                            {t('landing.heroTitle')}
                        </h2>

                        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 md:text-lg">
                            {t('landing.heroSubtitle')}
                        </p>

                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <Link
                                to="/register"
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-4 text-sm font-bold text-slate-950 shadow-xl shadow-emerald-500/20 transition hover:translate-y-[-1px] hover:brightness-110"
                            >
                                {t('landing.primaryCta')}
                                <FiArrowRight />
                            </Link>
                            <Link
                                to="/login"
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-4 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/30 hover:bg-white/[0.05]"
                            >
                                {t('landing.secondaryCta')}
                            </Link>
                        </div>

                        <div className="mt-8 rounded-3xl border border-emerald-300/20 bg-gradient-to-r from-emerald-400/10 to-cyan-400/10 p-5 backdrop-blur-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200/80">
                                {freeNoticeTitle}
                            </p>
                            <p className="mt-2 text-sm leading-7 text-slate-200 md:text-base">
                                {freeNoticeBody}
                            </p>
                        </div>

                        <div className="mt-10 grid gap-4 sm:grid-cols-3">
                            {stats.map((item) => (
                                <div key={item.label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-5 py-4 backdrop-blur-sm">
                                    <div className="text-2xl font-black text-white">{item.value}</div>
                                    <div className="mt-1 text-xs font-medium uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 rounded-[32px] bg-gradient-to-b from-emerald-400/10 to-cyan-400/5 blur-2xl" />
                        <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#08131d]/90 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl md:p-8">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-200/70">{t('landing.panelLabel')}</p>
                                    <h3 className="mt-2 text-2xl font-black text-white">{t('landing.panelTitle')}</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                                </div>
                            </div>

                            <div className="mt-8 space-y-4">
                                {features.map((feature, index) => {
                                    const Icon = featureIcons[index % featureIcons.length];

                                    return (
                                        <div
                                            key={feature.title}
                                            className="flex gap-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 transition hover:border-emerald-300/20 hover:bg-white/[0.05]"
                                        >
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/15 to-cyan-400/15 text-emerald-200">
                                                <Icon size={20} />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-white">{feature.title}</h4>
                                                <p className="mt-1 text-sm leading-6 text-slate-300">{feature.description}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="mt-8 rounded-3xl border border-white/8 bg-gradient-to-r from-white/[0.03] to-white/[0.02] p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{t('landing.stepsLabel')}</p>
                                <div className="mt-4 grid gap-3">
                                    {steps.map((step, index) => (
                                        <div key={step} className="flex items-center gap-3">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-black text-emerald-200">
                                                {index + 1}
                                            </div>
                                            <p className="text-sm text-slate-200">{step}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
