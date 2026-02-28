import React, { useState } from 'react';
import { FiArrowLeft, FiAlertTriangle, FiTrash2 } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';

export default function DeleteAccount() {
    const navigate = useNavigate();
    const [confirmText, setConfirmText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const { t } = useTranslation();

    const handleDelete = (e: React.FormEvent) => {
        e.preventDefault();
        if (confirmText !== 'DELETE') return;

        setIsDeleting(true);
        // Simulate API call
        setTimeout(() => {
            console.log('Account deleted');
            localStorage.removeItem('token');
            navigate('/login');
        }, 1500);
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-slate-200 relative overflow-hidden font-sans">
            {/* dynamic background effects */}
            <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-red-600/10 rounded-full blur-[120px] pointer-events-none" />

            {/* Navbar subset */}
            <nav className="relative z-10 border-b border-white/10 bg-white/5 backdrop-blur-md px-8 py-5 flex items-center">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="flex items-center text-slate-400 hover:text-white transition-colors group mr-6"
                >
                    <FiArrowLeft className="mr-2 group-hover:-translate-x-1 duration-200" /> {t('nav.backToDashboard')}
                </button>
            </nav>

            <main className="relative z-10 max-w-2xl mx-auto px-6 py-12">
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
                    <div className="flex items-center justify-center mb-6">
                        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center text-red-500">
                            <FiAlertTriangle size={32} />
                        </div>
                    </div>

                    <h1 className="text-3xl font-black text-center text-white mb-4">{t('delete.title')}</h1>

                    <div className="space-y-4 text-slate-300 mb-8 max-w-lg mx-auto text-center">
                        <p>
                            <Trans i18nKey="delete.warning">
                                You are about to permanently delete your <strong>Blue Lotus Network</strong> account.
                            </Trans>
                        </p>
                        <ul className="text-left bg-black/30 rounded-xl p-4 border border-white/5 space-y-2 text-sm mt-4">
                            {(t('delete.points', { returnObjects: true }) as string[]).map((point, i) => (
                                <li key={i} className="flex items-start">
                                    <span className="text-red-400 mr-2 mt-0.5">•</span>
                                    <Trans>{point}</Trans>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <form onSubmit={handleDelete} className="max-w-md mx-auto space-y-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                                {t('delete.confirmType')}
                            </label>
                            <input
                                type="text"
                                required
                                className="w-full px-4 py-3 bg-black/40 border border-red-500/30 rounded-xl text-slate-200 focus:ring-1 focus:ring-red-500/50 focus:border-red-500/50 outline-none transition-all duration-300 placeholder-slate-600 text-center font-mono uppercase"
                                placeholder="DELETE"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={confirmText !== 'DELETE' || isDeleting}
                            className={`w-full flex items-center justify-center py-4 px-4 rounded-xl font-bold transition-all duration-300 shadow-lg ${confirmText === 'DELETE' && !isDeleting
                                ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/25 transform hover:scale-[1.02] active:scale-95'
                                : 'bg-red-600/30 text-red-200/50 cursor-not-allowed'
                                }`}
                        >
                            {isDeleting ? t('delete.deleting') : (
                                <>
                                    <FiTrash2 className="mr-2" /> {t('delete.button')}
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
}
