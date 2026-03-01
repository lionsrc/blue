import { useTranslation } from 'react-i18next';

export default function LanguageSwitcher() {
    const { i18n } = useTranslation();
    const currentLang = i18n.language?.startsWith('zh') ? 'zh' : 'en';

    const toggleLanguage = () => {
        const next = currentLang === 'zh' ? 'en' : 'zh';
        i18n.changeLanguage(next);
    };

    return (
        <button
            onClick={toggleLanguage}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-full text-xs font-semibold text-slate-300 hover:text-white hover:border-white/20 transition-all duration-300 shadow-lg"
            aria-label="Switch language"
        >
            <span className="text-sm">{currentLang === 'zh' ? '🌐' : '🌐'}</span>
            {currentLang === 'zh' ? 'EN' : '中文'}
        </button>
    );
}
