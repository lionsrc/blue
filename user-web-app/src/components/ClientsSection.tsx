import { useTranslation } from 'react-i18next';
import { FiDownload, FiExternalLink } from 'react-icons/fi';

type Client = {
    name: string;
    platform: string;
    platformIcon: string;
    url: string;
    description: string;
    descriptionZh: string;
    free?: boolean;
};

const CLIENTS: Client[] = [
    {
        name: 'Clash Verge Rev',
        platform: 'macOS / Linux',
        platformIcon: '🧭',
        url: 'https://github.com/clash-verge-rev/clash-verge-rev/releases',
        description: 'Most popular desktop Mihomo client for macOS and Linux, with local Clash profile import.',
        descriptionZh: '当前最流行的 macOS / Linux 桌面 Mihomo 客户端，支持导入本地 Clash 配置。',
        free: true,
    },
    {
        name: 'v2rayN',
        platform: 'Windows',
        platformIcon: '🪟',
        url: 'https://github.com/2dust/v2rayN/releases',
        description: 'Most popular Windows V2Ray/Xray client. Free and open source.',
        descriptionZh: '当前最流行的 Windows V2Ray/Xray 客户端，免费开源。',
        free: true,
    },
    {
        name: 'v2rayNG',
        platform: 'Android',
        platformIcon: '📱',
        url: 'https://github.com/2dust/v2rayNG/releases',
        description: 'Most popular Android V2Ray/Xray client. Free on GitHub.',
        descriptionZh: '当前最流行的 Android V2Ray/Xray 客户端，可在 GitHub 免费下载。',
        free: true,
    },
    {
        name: 'Shadowrocket',
        platform: 'iOS',
        platformIcon: '🍎',
        url: 'https://apps.apple.com/app/shadowrocket/id932747118',
        description: 'Most popular iOS proxy client, with the highest visible App Store rating volume in this list.',
        descriptionZh: '当前最流行的 iOS 代理客户端，在此列表中拥有最高的 App Store 可见评分数量。',
    },
    {
        name: 'Hiddify',
        platform: 'All Platforms',
        platformIcon: '🌐',
        url: 'https://github.com/hiddify/hiddify-app/releases',
        description: 'Best cross-platform fallback if you want one client across Windows, macOS, Android, iOS and Linux.',
        descriptionZh: '如果你希望所有平台统一使用一个客户端，这是当前最好的跨平台备选。',
        free: true,
    },
];

type ClientsSectionProps = {
    variant?: 'landing' | 'dashboard';
};

export default function ClientsSection({ variant = 'landing' }: ClientsSectionProps) {
    const { i18n } = useTranslation();
    const isZh = i18n.language?.startsWith('zh');

    const sectionTitle = isZh ? '推荐客户端' : 'Recommended Clients';
    const sectionSubtitle = isZh
        ? '按当前平台主流客户端更新：Windows 用 v2rayN，Android 用 v2rayNG，iOS 用 Shadowrocket，macOS / Linux 用 Clash Verge Rev。'
        : 'Updated to current mainstream picks by platform: v2rayN for Windows, v2rayNG for Android, Shadowrocket for iOS, and Clash Verge Rev for macOS/Linux.';
    const freeLabel = isZh ? '免费' : 'Free';

    const isDashboard = variant === 'dashboard';

    return (
        <div className={isDashboard
            ? 'bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden mt-12 hover:border-white/20 transition-all duration-300'
            : 'mt-16 mx-auto max-w-6xl px-6 md:px-8 pb-20'
        }>
            <div className={isDashboard ? 'border-b border-white/10 px-8 py-6 bg-white/[0.02]' : 'mb-8'}>
                <h2 className={`font-bold text-white flex items-center ${isDashboard ? 'text-2xl mb-1' : 'text-3xl'}`}>
                    <FiDownload className={`mr-3 ${isDashboard ? 'text-blue-400' : 'text-emerald-400'}`} />
                    {sectionTitle}
                </h2>
                <p className={`text-slate-400 text-sm ${isDashboard ? 'ml-9' : 'mt-2'}`}>
                    {sectionSubtitle}
                </p>
            </div>

            <div className={isDashboard ? 'p-8' : ''}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {CLIENTS.map((client) => (
                        <a
                            key={client.name}
                            href={client.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative rounded-2xl border border-white/8 bg-white/[0.03] p-5 transition-all duration-300 hover:border-emerald-300/20 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-emerald-500/5"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">{client.platformIcon}</span>
                                    <div>
                                        <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                                            {client.name}
                                        </h3>
                                        <p className="text-xs text-slate-500 font-medium">{client.platform}</p>
                                    </div>
                                </div>
                                <FiExternalLink className="text-slate-600 group-hover:text-emerald-400 transition-colors mt-1" size={14} />
                            </div>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                {isZh ? client.descriptionZh : client.description}
                            </p>
                            {client.free && (
                                <span className="mt-3 inline-flex items-center rounded-full bg-emerald-400/10 border border-emerald-400/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                                    {freeLabel}
                                </span>
                            )}
                        </a>
                    ))}
                </div>
            </div>
        </div>
    );
}
