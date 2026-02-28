import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Translation files would ideally be in separate JSON files (e.g., locales/en/translation.json)
// but putting them here for simplicity in this project scope.

const resources = {
    en: {
        translation: {
            "nav": {
                "networkActive": "Network Active",
                "changeEmail": "Change Email",
                "changePassword": "Change Password",
                "paymentHistory": "Payment History",
                "logout": "Logout",
                "deleteAccount": "Delete Account",
                "backToDashboard": "Back to Dashboard"
            },
            "landing": {
                "brand": "Blue Lotus Network",
                "brandBadge": "Free Global Access",
                "login": "Login",
                "register": "Register",
                "ribbon": "Free Plan For Daily Browsing",
                "heroTitle": "If you mainly use websites and X/Twitter, the free plan is enough.",
                "heroSubtitle": "Blue Lotus Network is built around a real free tier. For everyday websites, social feeds, and light browsing, you can stay on free and keep using it. Upgrade only when you want higher speed or heavier traffic.",
                "primaryCta": "Start Free",
                "secondaryCta": "Login",
                "panelLabel": "Acceleration Matrix",
                "panelTitle": "Free First, Premium Ready",
                "freeNoticeTitle": "Websites and X/Twitter users can stay on free",
                "freeNoticeBody": "If your main use is reading websites, checking social feeds, or browsing X/Twitter, there is no need to upgrade immediately. The free plan is the default path.",
                "stepsLabel": "Quick Start",
                "features": [
                    {
                        "title": "Free Plan To Begin",
                        "description": "Start on the free tier first. If you mostly access websites or X/Twitter, you can keep using the free plan."
                    },
                    {
                        "title": "Global Relay Coverage",
                        "description": "Keeps nearby and long-haul regions on separate fast lanes for lower latency."
                    },
                    {
                        "title": "Private Session Protection",
                        "description": "Encrypted transport keeps account access and daily browsing on a safer channel."
                    },
                    {
                        "title": "One-Link Client Import",
                        "description": "Use a single subscription link for fast setup across mainstream clients."
                    }
                ],
                "stats": [
                    { "value": "Free", "label": "For Websites & X" },
                    { "value": "99.9%", "label": "Availability" },
                    { "value": "120+", "label": "Transit Routes" },
                    { "value": "24/7", "label": "Route Rotation" }
                ],
                "steps": [
                    "Create your free account and start browsing websites and X/Twitter without paying upfront.",
                    "Copy the generated subscription link into your preferred client.",
                    "Connect and let the platform keep your best route online."
                ]
            },
            "login": {
                "title": "Blue Lotus Network",
                "subtitle": "Sign in to your free acceleration account",
                "registerTitle": "Create Your Free Account",
                "registerSubtitle": "Register free and activate your acceleration service in minutes.",
                "emailLabel": "Email address",
                "emailPlaceholder": "you@example.com",
                "passwordLabel": "Password",
                "passwordPlaceholder": "••••••••",
                "signIn": "Sign In",
                "signingIn": "Signing In...",
                "creatingAccount": "Creating Account...",
                "encryptedAccess": "End-to-End Encrypted Access",
                "noAccount": "Don't have an account?",
                "signUp": "Sign Up",
                "alreadyHaveAccount": "Already have an account?",
                "backHome": "Back Home",
                "requestFailed": "Request failed. Please try again."
            },
            "dashboard": {
                "welcome": "Welcome back.",
                "manageAccess": "Manage your secure access and proxy configurations.",
                "activePlan": "Active Plan",
                "freeTier": "Free Starter",
                "basicTier": "Basic",
                "proPremium": "Pro Premium",
                "dataSpeed": "{{speed}} Mbps Data Speed",
                "accountBalance": "Account Balance",
                "addCredits": "Add credits to unlock unlimited bandwidth.",
                "topUp": "Top Up Balance",
                "monthlyTraffic": "Monthly Traffic Included",
                "trafficAllowance": "{{traffic}} GB / month",
                "freeUsageNote": "Free includes {{devices}} concurrent active session for websites and X/Twitter.",
                "paidUsageNote": "Paid plans allow concurrent sessions, and the node sync picks up your upgraded limits automatically.",
                "viewPlans": "View Plans",
                "planEyebrow": "Plans",
                "planSectionTitle": "Choose The Right Package After Login",
                "planSectionSubtitle": "Stay on the free tier for websites and X/Twitter, or move up when you need more devices, higher speed, and larger monthly traffic.",
                "freeMainPoint": "Free is the default path. If you mainly browse websites or use X/Twitter, you can keep using the free plan.",
                "recommended": "Main Pick",
                "devicesLabel": "Session Policy",
                "speedLabel": "Speed",
                "trafficLabel": "Traffic",
                "planPriceMonthly": "${{price}} / month",
                "unlimitedDevices": "Unlimited concurrent sessions",
                "singleDeviceCount": "{{count}} concurrent active session",
                "processingPlan": "Updating Plan...",
                "subscriptionUnavailable": "Your plan is updated, but no active node is available yet for subscription delivery.",
                "purchaseFailed": "Could not update your plan right now.",
                "loading": "Loading your dashboard...",
                "loadingHint": "Checking your plan, subscription, and node assignment.",
                "loadErrorTitle": "Dashboard unavailable",
                "loadError": "We could not load your account right now.",
                "awaitingNode": "Awaiting Node",
                "notConnected": "Not assigned yet",
                "nodeReady": "Online & Synced",
                "planNames": {
                    "free": "Free",
                    "basic": "Basic",
                    "pro": "Pro"
                },
                "planPrices": {
                    "free": "Free",
                    "basic": "$18 / month",
                    "pro": "$38 / month"
                },
                "planHighlights": {
                    "free": "Best for websites and X",
                    "basic": "Daily work and streaming",
                    "pro": "Heavy traffic and fast multi-device use"
                },
                "planDevices": {
                    "free": "1 device only",
                    "basic": "No device limit",
                    "pro": "No device limit"
                },
                "planCtas": {
                    "current": "Current Plan",
                    "free": "Use Free",
                    "basic": "Buy Basic",
                    "pro": "Buy Pro"
                },
                "subConfig": "Subscription Configuration",
                "importUrl": "Import this URL into v2rayN, Shadowrocket, or your preferred client.",
                "copyLink": "Copy Link",
                "copied": "Copied!",
                "liveMetrics": "Live Connection Metrics",
                "assignedNode": "Assigned Node",
                "protocol": "Protocol",
                "assignedPort": "Assigned Port",
                "nodeStatus": "Node Status"
            },
            "history": {
                "title": "Payment History",
                "txId": "Transaction ID",
                "date": "Date",
                "method": "Method",
                "amount": "Amount",
                "status": "Status",
                "completed": "Completed",
                "failed": "Failed",
                "noHistory": "No payment history found."
            },
            "delete": {
                "title": "Delete Account",
                "warning": "You are about to permanently delete your <1>Blue Lotus Network</1> account.",
                "points": [
                    "All active proxy nodes and allocated ports will be immediately released.",
                    "Any remaining credit balance will be forfeited.",
                    "Your payment history will be permanently erased.",
                    "This action <1>cannot</1> be undone."
                ],
                "confirmType": "Type 'DELETE' to confirm",
                "deleting": "Deleting Account...",
                "button": "Permanently Delete Account"
            },
            "email": {
                "title": "Change Email Address",
                "currentLabel": "Current Email",
                "newLabel": "New Email Address",
                "newPlaceholder": "new@example.com",
                "updating": "Updating...",
                "button": "Update Email Address",
                "success": "Email address updated successfully!"
            },
            "password": {
                "title": "Change Password",
                "currentLabel": "Current Password",
                "newLabel": "New Password",
                "confirmLabel": "Confirm New Password",
                "placeholder": "••••••••",
                "updating": "Updating...",
                "button": "Update Password",
                "success": "Password updated successfully!",
                "errorMatch": "New passwords do not match."
            }
        }
    },
    zh: {
        translation: {
            "nav": {
                "networkActive": "网络已连接",
                "changeEmail": "修改邮箱",
                "changePassword": "修改密码",
                "paymentHistory": "支付记录",
                "logout": "退出登录",
                "deleteAccount": "删除账号",
                "backToDashboard": "返回控制台"
            },
            "landing": {
                "brand": "Blue Lotus Network",
                "brandBadge": "免费全球加速",
                "login": "登录",
                "register": "注册",
                "ribbon": "日常浏览免费可用",
                "heroTitle": "如果你主要看网页和 X/Twitter，免费套餐就够用。",
                "heroSubtitle": "Blue Lotus Network 的核心卖点就是可长期使用的免费套餐。日常看网页、刷社交动态、访问 X/Twitter 这类轻度使用场景，可以直接长期使用免费版；只有在你需要更高速度或更重流量时再升级。",
                "primaryCta": "免费开始",
                "secondaryCta": "立即登录",
                "panelLabel": "加速矩阵",
                "panelTitle": "免费优先，进阶可选",
                "freeNoticeTitle": "看网页和刷 X/Twitter，继续用免费版就行",
                "freeNoticeBody": "如果你的主要需求只是访问网站、查看社交动态或刷 X/Twitter，就没必要急着升级。免费套餐就是默认推荐方案。",
                "stepsLabel": "使用步骤",
                "features": [
                    {
                        "title": "免费套餐先体验",
                        "description": "先用免费套餐体验线路质量。如果你主要是访问网站或刷 X/Twitter，可以一直使用免费版。"
                    },
                    {
                        "title": "全球中继覆盖",
                        "description": "针对近距离与跨区域链路分别优化，兼顾速度、稳定性与低延迟。"
                    },
                    {
                        "title": "私密加密传输",
                        "description": "使用加密传输保护日常访问链路，提升使用过程中的安全性。"
                    },
                    {
                        "title": "一键导入订阅",
                        "description": "支持主流客户端快速导入，减少重复配置和线路维护成本。"
                    }
                ],
                "stats": [
                    { "value": "免费", "label": "网页与 X 可用" },
                    { "value": "99.9%", "label": "在线率" },
                    { "value": "120+", "label": "中转线路" },
                    { "value": "24/7", "label": "智能切换" }
                ],
                "steps": [
                    "先注册免费账号，无需预付即可开始访问网页和 X/Twitter。",
                    "复制订阅链接，导入到常用客户端。",
                    "开始连接，系统会持续为你保持更优线路。"
                ]
            },
            "login": {
                "title": "Blue Lotus Network",
                "subtitle": "登录您的免费加速账户",
                "registerTitle": "创建免费账户",
                "registerSubtitle": "免费注册后即可快速启用您的加速服务。",
                "emailLabel": "电子邮箱",
                "emailPlaceholder": "you@example.com",
                "passwordLabel": "密码",
                "passwordPlaceholder": "••••••••",
                "signIn": "登 录",
                "signingIn": "登录中...",
                "creatingAccount": "创建账号中...",
                "encryptedAccess": "端到端加密访问",
                "noAccount": "还没有账号？",
                "signUp": "注 册",
                "alreadyHaveAccount": "已经有账号了？",
                "backHome": "返回首页",
                "requestFailed": "请求失败，请稍后重试。"
            },
            "dashboard": {
                "welcome": "欢迎回来。",
                "manageAccess": "管理您的安全访问和代理配置。",
                "activePlan": "当前套餐",
                "freeTier": "免费入门版",
                "basicTier": "基础版",
                "proPremium": "高级专业版",
                "dataSpeed": "{{speed}} Mbps 数据带宽",
                "accountBalance": "账户余额",
                "addCredits": "充值余额以解锁无限流量。",
                "topUp": "充 值",
                "monthlyTraffic": "每月包含流量",
                "trafficAllowance": "每月 {{traffic}} GB",
                "freeUsageNote": "免费版仅允许 {{devices}} 个并发在线会话，日常看网页和刷 X/Twitter 已经够用。",
                "paidUsageNote": "付费套餐允许并发在线，节点同步后会自动更新到新的套餐限制。",
                "viewPlans": "查看套餐",
                "planEyebrow": "套餐选项",
                "planSectionTitle": "登录后可直接选择套餐",
                "planSectionSubtitle": "如果你主要看网页和刷 X/Twitter，可以继续使用免费版；只有在需要更多设备、更高速度或更大月流量时再升级。",
                "freeMainPoint": "免费版就是主推方案。只要你主要是访问网站或使用 X/Twitter，就可以长期使用免费套餐。",
                "recommended": "主推",
                "devicesLabel": "会话策略",
                "speedLabel": "速度",
                "trafficLabel": "流量",
                "planPriceMonthly": "${{price}} / 月",
                "unlimitedDevices": "并发会话不限",
                "singleDeviceCount": "仅限 {{count}} 个并发在线会话",
                "processingPlan": "正在更新套餐...",
                "subscriptionUnavailable": "套餐已更新，但当前还没有可用节点可以下发订阅。",
                "purchaseFailed": "当前无法更新您的套餐。",
                "loading": "正在加载控制台...",
                "loadingHint": "正在检查您的套餐、订阅和节点分配。",
                "loadErrorTitle": "控制台暂时不可用",
                "loadError": "暂时无法加载您的账户信息。",
                "awaitingNode": "等待节点分配",
                "notConnected": "暂未分配",
                "nodeReady": "在线且已同步",
                "planNames": {
                    "free": "免费版",
                    "basic": "基础版",
                    "pro": "专业版"
                },
                "planPrices": {
                    "free": "免费",
                    "basic": "$18 / 月",
                    "pro": "$38 / 月"
                },
                "planHighlights": {
                    "free": "网页和 X/Twitter 首选",
                    "basic": "适合日常办公与高清视频",
                    "pro": "适合大流量和多设备高速使用"
                },
                "planDevices": {
                    "free": "仅限 1 台设备",
                    "basic": "设备不限",
                    "pro": "设备不限"
                },
                "planCtas": {
                    "current": "当前套餐",
                    "free": "切换免费版",
                    "basic": "购买基础版",
                    "pro": "购买专业版"
                },
                "subConfig": "订阅配置",
                "importUrl": "将此 URL 导入 v2rayN、Shadowrocket 或您首选的客户端。",
                "copyLink": "复制链接",
                "copied": "已复制!",
                "liveMetrics": "实时连接指标",
                "assignedNode": "分配节点",
                "protocol": "协议",
                "assignedPort": "分配端口",
                "nodeStatus": "节点状态"
            },
            "history": {
                "title": "支付记录",
                "txId": "交易 ID",
                "date": "日期",
                "method": "支付方式",
                "amount": "金额",
                "status": "状态",
                "completed": "已完成",
                "failed": "失败",
                "noHistory": "未找到支付记录。"
            },
            "delete": {
                "title": "删除账号",
                "warning": "您即将永久删除您的 <1>Blue Lotus Network</1> 账号。",
                "points": [
                    "所有活动的代理节点和分配的端口将被立即释放。",
                    "任何剩余的账户余额将被作废。",
                    "您的支付记录将被永久删除。",
                    "此操作<1>无法</1>撤销。"
                ],
                "confirmType": "输入 'DELETE' 以确认",
                "deleting": "正在删除账号...",
                "button": "永久删除账号"
            },
            "email": {
                "title": "修改电子邮箱",
                "currentLabel": "当前邮箱",
                "newLabel": "新邮箱",
                "newPlaceholder": "new@example.com",
                "updating": "更新中...",
                "button": "更新邮箱",
                "success": "邮箱更新成功！"
            },
            "password": {
                "title": "修改密码",
                "currentLabel": "当前密码",
                "newLabel": "新密码",
                "confirmLabel": "确认新密码",
                "placeholder": "••••••••",
                "updating": "更新中...",
                "button": "更新密码",
                "success": "密码更新成功！",
                "errorMatch": "新密码不匹配。"
            }
        }
    }
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        // "zh" is set as the default/fallback language globally as requested
        fallbackLng: 'zh',
        lng: 'zh',
        interpolation: {
            escapeValue: false, // react already safes from xss
        },
    });

export default i18n;
