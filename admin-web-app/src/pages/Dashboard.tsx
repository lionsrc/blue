import { useState, useEffect } from 'react';
import { useAuth } from '../auth';
import { LogOut, Users, Server, Activity, ShieldBan, MonitorPlay, Plus, Eye, X, Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import clsx from 'clsx';
import { useDebounce } from 'use-debounce';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';
const GRAFANA_URL = import.meta.env.VITE_GRAFANA_URL || '';

interface AdminUser {
    id: string;
    email: string;
    tier: string;
    subscriptionPlan: string;
    isActive: number;
    bandwidthLimitMbps: number;
    creditBalance: number;
    totalBytesUsed: number;
    currentPeriodBytesUsed: number;
    subscriptionEndDate: string | null;
    lastConnectTime: string | null;
    lastConnectIp: string | null;
    lastClientSoftware: string | null;
    createdAt: string;
    nodeId: string | null;
    port: number | null;
}

interface AdminNode {
    id: string;
    name: string;
    publicIp: string;
    status: string;
    activeConnections: number;
    cpuLoad: number;
    lastPing: string | null;
    allocationCount: number;
}

interface AdminPayment {
    id: string;
    amount: number;
    currency: string;
    status: string;
    paymentMethod: string | null;
    createdAt: string;
}

export default function Dashboard() {
    const { adminEmail, refreshSession, signOut } = useAuth();
    const [activeTab, setActiveTab] = useState<'users' | 'nodes' | 'monitoring'>('users');

    // --- Data State ---
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [nodes, setNodes] = useState<AdminNode[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // --- Pagination & Filtering State ---
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalUsers, setTotalUsers] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery] = useDebounce(searchQuery, 400);
    const [tierFilter, setTierFilter] = useState('all');

    // --- Add Node Modal State ---
    const [showAddNode, setShowAddNode] = useState(false);
    const [newNodeName, setNewNodeName] = useState('');
    const [newNodeIp, setNewNodeIp] = useState('');
    const [isAddingNode, setIsAddingNode] = useState(false);

    // --- User Details Modal State ---
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
    const [userPayments, setUserPayments] = useState<AdminPayment[]>([]);
    const [isLoadingPayments, setIsLoadingPayments] = useState(false);

    const formatBytes = (bytes: number | null | undefined) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    useEffect(() => {
        fetchData();
    }, [activeTab, currentPage, debouncedSearchQuery, tierFilter]);

    // Reset pagination when search or filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchQuery, tierFilter, activeTab]);

    const fetchData = async () => {
        if (activeTab === 'monitoring') {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            let endpoint = '';
            if (activeTab === 'users') {
                const params = new URLSearchParams({
                    page: currentPage.toString(),
                    limit: '20',
                    search: debouncedSearchQuery,
                    tier: tierFilter
                });
                endpoint = `/api/admin/users?${params.toString()}`;
            } else {
                endpoint = '/api/admin/nodes';
            }

            const res = await fetch(`${API_URL}${endpoint}`, {
                credentials: 'include',
            });
            if (res.status === 401 || res.status === 403) {
                await refreshSession();
                return;
            }
            const data = await res.json();
            if (activeTab === 'users') {
                setUsers(data.users || []);
                setTotalPages(data.totalPages || 1);
                setTotalUsers(data.total || 0);
            } else {
                setNodes(data.nodes || []);
            }
        } catch (err) {
            console.error("Failed to fetch data", err);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleUserBlock = async (userId: string, currentlyActive: boolean) => {
        try {
            await fetch(`${API_URL}/api/admin/users/${userId}/block`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain'
                },
                credentials: 'include',
                body: JSON.stringify({ block: currentlyActive }) // if currently active, send block: true
            });
            // Refresh list
            fetchData();
        } catch (err) {
            console.error("Failed to block user", err);
        }
    };

    const handleViewUser = async (user: AdminUser) => {
        setSelectedUser(user);
        setIsLoadingPayments(true);
        try {
            const res = await fetch(`${API_URL}/api/admin/users/${user.id}/payments`, {
                credentials: 'include',
            });
            if (res.status === 401 || res.status === 403) {
                await refreshSession();
                setSelectedUser(null);
                return;
            }
            if (res.ok) {
                const data = await res.json();
                setUserPayments(data.payments || []);
            }
        } catch (err) {
            console.error("Failed to fetch payments", err);
        } finally {
            setIsLoadingPayments(false);
        }
    };

    const handleAddNode = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsAddingNode(true);
        try {
            const res = await fetch(`${API_URL}/api/admin/nodes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain'
                },
                credentials: 'include',
                body: JSON.stringify({ name: newNodeName, publicIp: newNodeIp })
            });

            if (res.status === 401 || res.status === 403) {
                await refreshSession();
                return;
            }

            if (res.ok) {
                setShowAddNode(false);
                setNewNodeName('');
                setNewNodeIp('');
                fetchData();
            } else {
                const error = await res.json();
                alert(error.error || "Failed to add node");
            }
        } catch (err) {
            alert("Network err registering node");
        } finally {
            setIsAddingNode(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
            {/* Top Navigation */}
            <nav className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-500 shadow-lg shadow-blue-500/20 p-1">
                        <img src="/assets/logo.png" alt="Blue Lotus Network Logo" className="w-full h-full object-contain rounded-lg" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">
                            Blue Lotus Network
                        </h1>
                        <p className="text-xs text-gray-400">Management Console</p>
                    </div>
                </div>

                <button
                    onClick={signOut}
                    className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-gray-700/50 hover:bg-red-500/20 text-gray-300 hover:text-red-400 transition-colors"
                >
                    <LogOut size={16} />
                    <span>Sign Out</span>
                </button>
            </nav>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <aside className="w-64 bg-gray-800/50 border-r border-gray-700 p-4 space-y-2 hidden md:block">
                    <button
                        onClick={() => setActiveTab('users')}
                        className={clsx(
                            "w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors text-left",
                            activeTab === 'users' ? "bg-blue-600/20 text-blue-400 font-medium" : "hover:bg-gray-700 text-gray-400"
                        )}
                    >
                        <Users size={18} />
                        <span>User Accounts</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('nodes')}
                        className={clsx(
                            "w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors text-left",
                            activeTab === 'nodes' ? "bg-blue-600/20 text-blue-400 font-medium" : "hover:bg-gray-700 text-gray-400"
                        )}
                    >
                        <Server size={18} />
                        <span>Proxy Nodes</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('monitoring')}
                        className={clsx(
                            "w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors text-left",
                            activeTab === 'monitoring' ? "bg-blue-600/20 text-blue-400 font-medium" : "hover:bg-gray-700 text-gray-400"
                        )}
                    >
                        <MonitorPlay size={18} />
                        <span>Monitoring</span>
                    </button>
                </aside>

                {/* Dynamic View */}
                <main className="flex-1 overflow-y-auto p-6 md:p-8">
                    <div className="max-w-6xl mx-auto space-y-6">

                        {/* Header Area */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-2xl font-bold text-white tracking-tight">
                                    {activeTab === 'users'
                                        ? 'User Directory'
                                        : activeTab === 'nodes'
                                            ? 'Node Fleet'
                                            : 'Monitoring'}
                                </h2>
                                <p className="text-gray-400 mt-1">
                                    {activeTab === 'users'
                                        ? 'Manage user access, tiers, and bandwidth limits.'
                                        : activeTab === 'nodes'
                                            ? 'Monitor server health and provision new endpoints.'
                                            : 'Open the external Grafana dashboards hosted on the monitoring VPS.'}
                                </p>
                                {adminEmail && (
                                    <p className="text-xs text-gray-500 mt-2">
                                        Access identity: {adminEmail}
                                    </p>
                                )}
                            </div>

                            {activeTab === 'nodes' ? (
                                <button
                                    onClick={() => setShowAddNode(true)}
                                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center space-x-2 shadow-lg shadow-blue-500/20 transition"
                                >
                                    <Plus size={18} />
                                    <span>Add Node</span>
                                </button>
                            ) : activeTab === 'monitoring' && GRAFANA_URL ? (
                                <a
                                    href={GRAFANA_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center space-x-2 shadow-lg shadow-blue-500/20 transition"
                                >
                                    <MonitorPlay size={18} />
                                    <span>Open Grafana</span>
                                </a>
                            ) : null}
                        </div>

                        {/* Content Table Container */}
                        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                    <Activity size={32} className="animate-spin mb-4 text-blue-500" />
                                    <p>Loading {activeTab} data...</p>
                                </div>
                            ) : activeTab === 'users' ? (
                                // --- USERS TABLE ---
                                <div className="space-y-4 p-4">
                                    {/* Filters Bar */}
                                    <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                                        <div className="relative w-full sm:max-w-md">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <Search size={16} className="text-gray-500" />
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Search by email..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
                                            />
                                        </div>
                                        <div className="relative w-full sm:w-auto min-w-[150px]">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <Filter size={16} className="text-gray-500" />
                                            </div>
                                            <select
                                                value={tierFilter}
                                                onChange={(e) => setTierFilter(e.target.value)}
                                                className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-8 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none transition-shadow cursor-pointer"
                                            >
                                                <option value="all">All Tiers</option>
                                                <option value="free">Free</option>
                                                <option value="basic">Basic</option>
                                                <option value="pro">Pro</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Data Table */}
                                    <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800">
                                        <table className="w-full text-left text-sm text-gray-300">
                                            <thead className="bg-gray-900/50 text-xs uppercase text-gray-400 border-b border-gray-700">
                                                <tr>
                                                    <th className="px-6 py-4 font-medium">User</th>
                                                    <th className="px-6 py-4 font-medium">Tier / Speeds</th>
                                                    <th className="px-6 py-4 font-medium">Active Node</th>
                                                    <th className="px-6 py-4 font-medium">Status</th>
                                                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-700/50">
                                                {users.length === 0 ? (
                                                    <tr><td colSpan={5} className="text-center py-8 text-gray-500">No users found</td></tr>
                                                ) : users.map(user => (
                                                    <tr key={user.id} className="hover:bg-gray-700/20 transition-colors group">
                                                        <td className="px-6 py-4">
                                                            <div className="font-medium text-gray-200">{user.email}</div>
                                                            <div className="text-xs text-gray-500 mt-0.5">{user.id.split('-')[0]}***</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                                                {user.tier.toUpperCase()}
                                                            </div>
                                                            <div className="text-xs text-gray-500 mt-1">Limit: {user.bandwidthLimitMbps} Mbps</div>
                                                        </td>
                                                        <td className="px-6 py-4 text-gray-400">
                                                            {user.nodeId ? (
                                                                <div className="flex items-center space-x-1">
                                                                    <MonitorPlay size={14} className="text-green-500" />
                                                                    <span>Port: {user.port}</span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-600 italic">Not Connected</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={clsx("inline-flex items-center space-x-1.5 px-2 py-1 rounded-full text-xs font-medium border",
                                                                user.isActive
                                                                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                                                                    : "bg-red-500/10 text-red-400 border-red-500/20"
                                                            )}>
                                                                <span className={clsx("w-1.5 h-1.5 rounded-full", user.isActive ? "bg-green-400" : "bg-red-400")}></span>
                                                                <span>{user.isActive ? 'Active' : 'Blocked'}</span>
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <div className="flex items-center space-x-2 justify-end">
                                                                <button
                                                                    onClick={() => handleViewUser(user)}
                                                                    className="px-3 py-1.5 rounded text-xs font-medium border bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white transition-colors flex items-center space-x-1"
                                                                >
                                                                    <Eye size={14} />
                                                                    <span>Details</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => toggleUserBlock(user.id, !!user.isActive)}
                                                                    className={clsx(
                                                                        "px-3 py-1.5 rounded text-xs font-medium border transition-colors flex items-center space-x-1",
                                                                        user.isActive
                                                                            ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white"
                                                                            : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white"
                                                                    )}
                                                                >
                                                                    <ShieldBan size={14} />
                                                                    <span>{user.isActive ? 'Block' : 'Unblock'}</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Pagination Controls */}
                                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                                        <div className="text-sm text-gray-400">
                                            Showing <span className="font-medium text-white">{users.length}</span> of{' '}
                                            <span className="font-medium text-white">{totalUsers}</span> users
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <button
                                                disabled={currentPage <= 1}
                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                className="p-1 rounded-md border border-gray-700 bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <ChevronLeft size={18} />
                                            </button>
                                            <span className="text-xs text-gray-500 font-medium px-2">
                                                Page {currentPage} of {Math.max(1, totalPages)}
                                            </span>
                                            <button
                                                disabled={currentPage >= totalPages}
                                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                className="p-1 rounded-md border border-gray-700 bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <ChevronRight size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : activeTab === 'nodes' ? (
                                // --- NODES TABLE ---
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm text-gray-300">
                                        <thead className="bg-gray-900/50 text-xs uppercase text-gray-400 border-b border-gray-700">
                                            <tr>
                                                <th className="px-6 py-4 font-medium">Server Name / IP</th>
                                                <th className="px-6 py-4 font-medium">Status</th>
                                                <th className="px-6 py-4 font-medium">Client Load</th>
                                                <th className="px-6 py-4 font-medium text-right">Last Ping</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-700/50">
                                            {nodes.length === 0 ? (
                                                <tr><td colSpan={5} className="text-center py-8 text-gray-500">No nodes found</td></tr>
                                            ) : nodes.map(node => (
                                                <tr key={node.id} className="hover:bg-gray-700/20 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="font-medium text-gray-200">{node.name}</div>
                                                        <div className="text-xs text-gray-400 mt-0.5 font-mono">{node.publicIp}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={clsx("inline-flex px-2 py-1 rounded-full text-xs font-medium border",
                                                            node.status === 'active' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                                                                node.status === 'provisioning' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                                    "bg-red-500/10 text-red-400 border-red-500/20"
                                                        )}>
                                                            {node.status.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col justify-center">
                                                            <span className="text-sm font-medium text-gray-300">{node.allocationCount} active routes</span>
                                                            <div className="w-32 h-1.5 bg-gray-700 rounded-full mt-1.5 overflow-hidden">
                                                                {/* Mock visual load bar based on mock max 100 conns */}
                                                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min((node.allocationCount / 100) * 100, 100)}%` }}></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right text-xs text-gray-400">
                                                        {node.lastPing ? new Date(node.lastPing).toLocaleString() : 'Never'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="p-8 md:p-10">
                                    <div className="grid gap-6 md:grid-cols-2">
                                        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                                            <div className="flex items-center space-x-3">
                                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600/10 text-blue-400">
                                                    <MonitorPlay size={22} />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-semibold text-white">Grafana Dashboards</h3>
                                                    <p className="text-sm text-gray-400">Launch the monitoring workspace on the dedicated VPS.</p>
                                                </div>
                                            </div>

                                            <p className="mt-5 text-sm leading-6 text-gray-300">
                                                Grafana stays separate from the admin UI so it can keep its own sessions, plugins, and dashboard routing.
                                                Open it in a new tab for the full monitoring experience.
                                            </p>

                                            <div className="mt-6">
                                                {GRAFANA_URL ? (
                                                    <a
                                                        href={GRAFANA_URL}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                                                    >
                                                        <MonitorPlay size={16} />
                                                        <span>Open Grafana</span>
                                                    </a>
                                                ) : (
                                                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                                                        Set <code className="text-amber-200">VITE_GRAFANA_URL</code> for the deployed admin app to enable the Grafana launch link.
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                                            <h3 className="text-lg font-semibold text-white">Recommended Setup</h3>
                                            <ul className="mt-4 space-y-3 text-sm text-gray-300">
                                                <li>Protect the Grafana hostname with Cloudflare Access, just like the admin portal.</li>
                                                <li>Point <code className="text-blue-300">VITE_GRAFANA_URL</code> at the external Grafana URL.</li>
                                                <li>Keep Grafana credentials and dashboards managed on the monitoring VPS.</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                    </div>
                </main>
            </div>

            {/* Add Node Modal overlay */}
            {showAddNode && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold text-white mb-2">Register Proxy Node</h3>
                        <p className="text-gray-400 text-sm mb-6">
                            Adds a new VPS server to the pool. You must still run the <code className="text-blue-400">setup_proxy_node.sh</code> script on the target machine.
                        </p>

                        <form onSubmit={handleAddNode} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Node Name</label>
                                <input required type="text" value={newNodeName} onChange={e => setNewNodeName(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="e.g. us-east-1" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Public IP Address</label>
                                <input required type="text" value={newNodeIp} onChange={e => setNewNodeIp(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                    placeholder="198.51.100.23" />
                            </div>

                            <div className="flex justify-end space-x-3 mt-8">
                                <button type="button" onClick={() => setShowAddNode(false)} className="px-4 py-2 text-gray-400 hover:text-white transition">Cancel</button>
                                <button type="submit" disabled={isAddingNode} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg transition disabled:opacity-50">
                                    {isAddingNode ? 'Adding...' : 'Register Node'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* User Details Modal */}
            {selectedUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/80 sticky top-0">
                            <div>
                                <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                                    <span>{selectedUser.email}</span>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                        {selectedUser.tier.toUpperCase()}
                                    </span>
                                </h3>
                                <p className="text-gray-400 text-sm mt-1">ID: <span className="font-mono">{selectedUser.id}</span></p>
                            </div>
                            <button onClick={() => setSelectedUser(null)} className="text-gray-400 hover:text-white transition p-2 hover:bg-gray-700 rounded-lg">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Scrollable Body */}
                        <div className="p-6 overflow-y-auto flex-1 space-y-8">

                            {/* Analytics Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                                    <h4 className="text-sm border-b border-gray-700 pb-2 mb-3 font-semibold text-gray-300 uppercase tracking-wider">Usage & Access</h4>
                                    <div className="space-y-3 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Traffic Used:</span>
                                            <span className="text-white font-mono">{formatBytes(selectedUser.totalBytesUsed)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Speed Limit:</span>
                                            <span className="text-white">{selectedUser.bandwidthLimitMbps} Mbps</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Account Created:</span>
                                            <span className="text-white">{new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                                    <h4 className="text-sm border-b border-gray-700 pb-2 mb-3 font-semibold text-gray-300 uppercase tracking-wider">Device Telemetry</h4>
                                    <div className="space-y-3 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Last Connected:</span>
                                            <span className="text-white">{selectedUser.lastConnectTime ? new Date(selectedUser.lastConnectTime).toLocaleString() : 'Never'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Last Setup IP:</span>
                                            <span className="text-white font-mono">{selectedUser.lastConnectIp || 'Unknown'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Client Software:</span>
                                            <span className="text-white">{selectedUser.lastClientSoftware || 'Unknown'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Payment History */}
                            <div>
                                <h4 className="text-lg font-bold text-white mb-4">Payment History</h4>
                                <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                                    {isLoadingPayments ? (
                                        <div className="py-8 flex justify-center text-blue-500"><Activity size={24} className="animate-spin" /></div>
                                    ) : userPayments.length === 0 ? (
                                        <div className="py-8 text-center text-sm text-gray-500">No payments found for this user.</div>
                                    ) : (
                                        <table className="w-full text-left text-sm text-gray-300">
                                            <thead className="bg-gray-800 text-xs uppercase text-gray-400 border-b border-gray-700">
                                                <tr>
                                                    <th className="px-4 py-3 font-medium">Date</th>
                                                    <th className="px-4 py-3 font-medium">Amount</th>
                                                    <th className="px-4 py-3 font-medium">Method</th>
                                                    <th className="px-4 py-3 font-medium text-right">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-700/50">
                                                {userPayments.map((payment) => (
                                                    <tr key={payment.id} className="hover:bg-gray-800/50">
                                                        <td className="px-4 py-3">{new Date(payment.createdAt).toLocaleDateString()}</td>
                                                        <td className="px-4 py-3 font-medium">${payment.amount.toFixed(2)} {payment.currency}</td>
                                                        <td className="px-4 py-3 capitalize">{payment.paymentMethod}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <span className={clsx("inline-flex px-2 py-0.5 rounded text-xs font-medium border",
                                                                payment.status === 'completed' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                                                                    payment.status === 'pending' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                                        "bg-red-500/10 text-red-400 border-red-500/20"
                                                            )}>
                                                                {payment.status.toUpperCase()}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
