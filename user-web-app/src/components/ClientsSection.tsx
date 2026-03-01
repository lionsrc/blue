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
        name: 'v2rayN',
        platform: 'Windows',
        platformIcon: '🪟',
        url: 'https://github.com/2dust/v2rayN/releases',
        description: 'Most popular Windows proxy client. Free & open source.',
        descriptionZh: '最流行的 Windows 代理客户端，免费开源。',
        free: true,
    },
    {
        name: 'v2rayNG',
        platform: 'Android',
        platformIcon: '📱',
        url: 'https://github.com/2dust/v2rayNG/releases',
        description: 'Official Android client by v2ray. Free on GitHub.',
        descriptionZh: 'v2ray 官方 Android 客户端，GitHub 免费下载。',
        free: true,
    },
    {
        name: 'Shadowrocket',
        platform: 'iOS',
        platformIcon: '🍎',
        url: 'https://apps.apple.com/app/shadowrocket/id932747118',
        description: 'Fast & lightweight iOS proxy client. $2.99 one-time.',
        descriptionZh: '轻量级 iOS 代理客户端，一次性购买 $2.99。',
    },
    {
        name: 'V2rayU',
        platform: 'macOS',
        platformIcon: '💻',
        url: 'https://github.com/yanue/V2rayU/releases',
        description: 'Simple macOS client with menu bar control. Free.',
        descriptionZh: '简洁的 macOS 客户端，支持菜单栏控制，免费。',
        free: true,
    },
    {
        name: 'Hiddify',
        platform: 'All Platforms',
        platformIcon: '🌐',
        url: 'https://github.com/hiddify/hiddify-app/releases',
        description: 'Cross-platform client for Windows, macOS, Android, iOS & Linux.',
        descriptionZh: '跨平台客户端，支持 Windows、macOS、Android、iOS 和 Linux。',
        free: true,
    },
    {
        name: 'Quantumult X',
        platform: 'iOS',
        platformIcon: '🍎',
        url: 'https://apps.apple.com/app/quantumult-x/id1443988620',
        description: 'Advanced iOS proxy tool with powerful rules engine. $7.99.',
        descriptionZh: '高级 iOS 代理工具，强大的规则引擎，$7.99。',
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
        ? '复制订阅链接后，导入到以下任意客户端即可使用。'
        : 'Copy your subscription link and import it into any of these clients.';
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
