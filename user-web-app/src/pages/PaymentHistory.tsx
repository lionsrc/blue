import { FiArrowLeft, FiClock, FiCheckCircle, FiXCircle } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PaymentHistory() {
    const navigate = useNavigate();
    const { t } = useTranslation();

    // Mock payment data
    const payments = [
        { id: 'pay_1A2b3C', date: '2026-02-25', amount: 10.00, method: 'Crypto (USDT)', status: 'completed' },
        { id: 'pay_4D5e6F', date: '2026-01-20', amount: 25.00, method: 'Credit Card', status: 'completed' },
        { id: 'pay_7G8h9I', date: '2025-12-15', amount: 10.00, method: 'Crypto (USDT)', status: 'failed' },
        { id: 'pay_0J1k2L', date: '2025-11-01', amount: 50.00, method: 'Crypto (USDT)', status: 'completed' },
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-slate-200 relative overflow-hidden font-sans">
            {/* dynamic background effects */}
            <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/10 rounded-full blur-[120px] pointer-events-none" />

            {/* Navbar subset */}
            <nav className="relative z-10 border-b border-white/10 bg-white/5 backdrop-blur-md px-8 py-5 flex items-center">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="flex items-center text-slate-400 hover:text-white transition-colors group mr-6"
                >
                    <FiArrowLeft className="mr-2 group-hover:-translate-x-1 duration-200" /> {t('nav.backToDashboard')}
                </button>
                <div className="h-6 w-px bg-white/10 mx-4"></div>
                <span className="font-bold text-xl text-white flex items-center">
                    <FiClock className="mr-2 text-indigo-400" /> {t('history.title')}
                </span>
            </nav>

            <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">
                <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white/[0.02] border-b border-white/10 text-xs font-bold uppercase tracking-widest text-slate-400">
                                    <th className="py-4 px-6">{t('history.txId')}</th>
                                    <th className="py-4 px-6">{t('history.date')}</th>
                                    <th className="py-4 px-6">{t('history.method')}</th>
                                    <th className="py-4 px-6 text-right">{t('history.amount')}</th>
                                    <th className="py-4 px-6 text-center">{t('history.status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payments.map((payment, index) => (
                                    <tr key={payment.id} className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${index === payments.length - 1 ? 'border-b-0' : ''}`}>
                                        <td className="py-4 px-6 font-mono text-slate-300 text-sm">{payment.id}</td>
                                        <td className="py-4 px-6 text-slate-400">{payment.date}</td>
                                        <td className="py-4 px-6 text-slate-300">{payment.method}</td>
                                        <td className="py-4 px-6 text-right font-bold text-white">${payment.amount.toFixed(2)}</td>
                                        <td className="py-4 px-6 text-center">
                                            {payment.status === 'completed' ? (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                    <FiCheckCircle className="mr-1.5" /> {t('history.completed')}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                                                    <FiXCircle className="mr-1.5" /> {t('history.failed')}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {payments.length === 0 && (
                            <div className="py-12 text-center text-slate-500">
                                {t('history.noHistory')}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
