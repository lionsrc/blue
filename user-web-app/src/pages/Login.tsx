import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiLock, FiMail, FiArrowRight, FiShield } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';

type LoginProps = {
    mode?: 'login' | 'register';
};

export default function Login({ mode = 'login' }: LoginProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const isRegistering = mode === 'register';
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');

        try {
            if (isRegistering) {
                const signupResponse = await fetch(`${apiUrl}/api/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, lang: i18n.language?.startsWith('zh') ? 'zh' : 'en' }),
                });

                const signupData = await signupResponse.json() as { error?: string; requiresVerification?: boolean };
                if (!signupResponse.ok) {
                    throw new Error(signupData.error || t('login.requestFailed'));
                }

                if (signupData.requiresVerification) {
                    navigate(`/verify-email?email=${encodeURIComponent(email)}`);
                    return;
                }
            }

            const loginResponse = await fetch(`${apiUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const loginData = await loginResponse.json() as { accessToken?: string; error?: string; requiresVerification?: boolean };

            if (loginData.requiresVerification) {
                navigate(`/verify-email?email=${encodeURIComponent(email)}`);
                return;
            }

            if (!loginResponse.ok || !loginData.accessToken) {
                throw new Error(loginData.error || t('login.requestFailed'));
            }

            localStorage.setItem('token', loginData.accessToken);
            navigate('/dashboard');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('login.requestFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a] text-slate-200 relative overflow-hidden font-sans">
            {/* dynamic background effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

            <div className="relative z-10 w-full max-w-md p-10 bg-white/5 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 group hover:border-white/20 transition-colors duration-500">
                <Link
                    to="/"
                    className="inline-flex items-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 transition hover:text-white"
                >
                    <FiArrowLeft className="mr-2" />
                    {t('login.backHome')}
                </Link>

                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center p-1 rounded-3xl bg-white/5 border border-white/10 shadow-xl shadow-emerald-500/30 mb-6 transform group-hover:scale-105 group-hover:-rotate-3 transition-all duration-500">
                        <img src="/assets/logo.png" alt="Blue Lotus Network Logo" className="h-20 w-20 object-contain rounded-2xl" />
                    </div>
                    <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 mb-2">
                        {isRegistering ? t('login.registerTitle') : t('login.title')}
                    </h1>
                    <p className="text-slate-400 text-sm font-medium">
                        {isRegistering ? t('login.registerSubtitle') : t('login.subtitle')}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('login.emailLabel')}</label>
                        <div className="relative group/input">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within/input:text-emerald-300 transition-colors">
                                <FiMail />
                            </div>
                            <input
                                type="email"
                                required
                                className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-slate-200 focus:ring-1 focus:ring-emerald-400/40 focus:border-emerald-400/40 outline-none transition-all duration-300 placeholder-slate-600"
                                placeholder={t('login.emailPlaceholder')}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('login.passwordLabel')}</label>
                        <div className="relative group/input">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within/input:text-emerald-300 transition-colors">
                                <FiLock />
                            </div>
                            <input
                                type="password"
                                required
                                className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-slate-200 focus:ring-1 focus:ring-emerald-400/40 focus:border-emerald-400/40 outline-none transition-all duration-300 placeholder-slate-600"
                                placeholder={t('login.passwordPlaceholder')}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full flex items-center justify-center py-4 px-4 bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 rounded-xl font-bold transition-all duration-300 shadow-lg shadow-emerald-500/20 transform hover:scale-[1.02] active:scale-95 group/btn"
                    >
                        {submitting ? (isRegistering ? t('login.creatingAccount') : t('login.signingIn')) : (isRegistering ? t('login.signUp') : t('login.signIn'))}
                        <FiArrowRight className="ml-2 group-hover/btn:translate-x-1 transition-transform" />
                    </button>

                    <div className="flex items-center justify-center mt-6 text-xs text-slate-500 space-x-2">
                        <FiShield className="text-emerald-500/70" />
                        <span>{t('login.encryptedAccess')}</span>
                    </div>
                </form>

                <div className="mt-8 text-center text-sm text-slate-400 border-t border-white/5 pt-6">
                    {isRegistering ? t('login.alreadyHaveAccount') + ' ' : t('login.noAccount') + ' '}
                    <Link
                        to={isRegistering ? '/login' : '/register'}
                        className="text-emerald-300 hover:text-emerald-200 font-bold transition-colors"
                    >
                        {isRegistering ? t('login.signIn') : t('login.signUp')}
                    </Link>
                </div>
            </div>
        </div>
    );
}
