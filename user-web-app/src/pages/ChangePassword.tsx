import React, { useState } from 'react';
import { FiArrowLeft, FiLock, FiCheck } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function ChangePassword() {
    const navigate = useNavigate();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [error, setError] = useState('');
    const { t } = useTranslation();
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787';
    const token = localStorage.getItem('token');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError(t('password.errorMatch'));
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await fetch(`${apiUrl}/api/change-password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'text/plain',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Failed to update password');
                return;
            }
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSuccessMessage(t('password.success'));
            setTimeout(() => setSuccessMessage(''), 3000);
        } catch {
            setError('Network error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-slate-200 relative overflow-hidden font-sans">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

            <nav className="relative z-10 border-b border-white/10 bg-white/5 backdrop-blur-md px-8 py-5 flex items-center">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="flex items-center text-slate-400 hover:text-white transition-colors group mr-6"
                >
                    <FiArrowLeft className="mr-2 group-hover:-translate-x-1 duration-200" /> {t('nav.backToDashboard')}
                </button>
            </nav>

            <main className="relative z-10 max-w-xl mx-auto px-6 py-12">
                <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-8">
                    <div className="flex items-center mb-6">
                        <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400 mr-4">
                            <FiLock size={24} />
                        </div>
                        <h1 className="text-2xl font-bold text-white">{t('password.title')}</h1>
                    </div>

                    {successMessage && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl mb-6 flex items-center">
                            <FiCheck className="mr-2" /> {successMessage}
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl mb-6">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('password.currentLabel')}</label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within/input:text-purple-400 transition-colors">
                                    <FiLock />
                                </div>
                                <input
                                    type="password"
                                    required
                                    className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-slate-200 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 outline-none transition-all duration-300 placeholder-slate-600"
                                    placeholder={t('password.placeholder')}
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        <hr className="border-white/10 my-6" />

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('password.newLabel')}</label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within/input:text-purple-400 transition-colors">
                                    <FiLock />
                                </div>
                                <input
                                    type="password"
                                    required
                                    className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-slate-200 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 outline-none transition-all duration-300 placeholder-slate-600"
                                    placeholder={t('password.placeholder')}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('password.confirmLabel')}</label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within/input:text-purple-400 transition-colors">
                                    <FiLock />
                                </div>
                                <input
                                    type="password"
                                    required
                                    className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-slate-200 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 outline-none transition-all duration-300 placeholder-slate-600"
                                    placeholder={t('password.placeholder')}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
                            className={`w-full flex items-center justify-center py-3.5 px-4 rounded-xl font-bold transition-all duration-300 shadow-lg mt-8 ${(!currentPassword || !newPassword || !confirmPassword || isSubmitting)
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-500/25 transform hover:scale-[1.02] active:scale-95'
                                }`}
                        >
                            {isSubmitting ? t('password.updating') : t('password.button')}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
}
