import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiArrowLeft, FiMail, FiArrowRight, FiCheckCircle, FiRefreshCw } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';

export default function VerifyEmail() {
    const [searchParams] = useSearchParams();
    const emailFromQuery = searchParams.get('email') || '';
    const [code, setCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [resending, setResending] = useState(false);
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787';

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');
        setSuccess('');

        try {
            const response = await fetch(`${apiUrl}/api/verify-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ email: emailFromQuery, code }),
            });

            const data = await response.json() as { message?: string; error?: string };
            if (!response.ok) {
                throw new Error(data.error || t('verify.failed'));
            }

            setSuccess(data.message || t('verify.success'));
            setTimeout(() => navigate('/login'), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('verify.failed'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleResend = async () => {
        setResending(true);
        setError('');
        setSuccess('');

        try {
            const response = await fetch(`${apiUrl}/api/resend-verification`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ email: emailFromQuery, lang: i18n.language?.startsWith('zh') ? 'zh' : 'en' }),
            });

            const data = await response.json() as { message?: string; error?: string };
            if (!response.ok) {
                throw new Error(data.error || t('verify.resendFailed'));
            }

            setSuccess(data.message || t('verify.codeSent'));
        } catch (err) {
            setError(err instanceof Error ? err.message : t('verify.resendFailed'));
        } finally {
            setResending(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a] text-slate-200 relative overflow-hidden font-sans">
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

            <div className="relative z-10 w-full max-w-md p-10 bg-white/5 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 group hover:border-white/20 transition-colors duration-500">
                <Link
                    to="/login"
                    className="inline-flex items-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 transition hover:text-white"
                >
                    <FiArrowLeft className="mr-2" />
                    {t('verify.backToLogin')}
                </Link>

                <div className="text-center mb-10">
                    <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/30 mb-6 transform group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                        <FiMail size={28} />
                    </div>
                    <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 mb-2">
                        {t('verify.title')}
                    </h1>
                    <p className="text-slate-400 text-sm font-medium">
                        {t('verify.subtitle')} <span className="text-emerald-300 font-bold">{emailFromQuery}</span>
                    </p>
                </div>

                <form onSubmit={handleVerify} className="space-y-6">
                    {error && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 flex items-center gap-2">
                            <FiCheckCircle />
                            {success}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('verify.codeLabel')}</label>
                        <input
                            type="text"
                            required
                            maxLength={6}
                            className="w-full text-center text-3xl tracking-[0.6em] py-4 bg-black/40 border border-white/10 rounded-xl text-slate-200 focus:ring-1 focus:ring-emerald-400/40 focus:border-emerald-400/40 outline-none transition-all duration-300 placeholder-slate-600 font-mono"
                            placeholder="000000"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={submitting || code.length !== 6}
                        className="w-full flex items-center justify-center py-4 px-4 bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 rounded-xl font-bold transition-all duration-300 shadow-lg shadow-emerald-500/20 transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                        {submitting ? t('verify.verifying') : t('verify.verifyButton')}
                        <FiArrowRight className="ml-2" />
                    </button>

                    <div className="text-center pt-2">
                        <button
                            type="button"
                            onClick={handleResend}
                            disabled={resending}
                            className="inline-flex items-center text-sm text-slate-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                        >
                            <FiRefreshCw className={`mr-2 ${resending ? 'animate-spin' : ''}`} />
                            {resending ? t('verify.sending') : t('verify.resendCode')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
