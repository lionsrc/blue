import { useState, useEffect } from 'react';
import { useAuth } from '../auth';
import { LogOut, Users, Server, Activity, ShieldBan, MonitorPlay, Plus, Eye, X, Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import clsx from 'clsx';
import { useDebounce } from 'use-debounce';
import { buildApiUrl } from '../api';

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
    nodeName: string | null;
    nodePublicIp: string | null;
}

interface AdminNode {
    id: string;
    name: string;
    publicIp: string;
    status: string;
    activeConnections: number;
    cpuLoad: number;
    lastPing: string | null;
    ipUpdatedAt: string | null;
    agentTokenConfigured: number;
    allocationCount: number;
}

interface NodeCredentials {
    nodeId: string;
    agentToken: string;
    nodeName: string;
    source: 'created' | 'rotated';
}

interface NodeIpHistoryEntry {
    id: string;
    previousIp: string | null;
    newIp: string;
    changedAt: string;
}

interface NodeHistoryModalState {
    nodeId: string;
    nodeName: string;
    history: NodeIpHistoryEntry[];
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
    const [addNodeError, setAddNodeError] = useState<string | null>(null);
    const [nodeActionError, setNodeActionError] = useState<string | null>(null);
    const [nodeCredentials, setNodeCredentials] = useState<NodeCredentials | null>(null);
    const [copiedValue, setCopiedValue] = useState<string | null>(null);
    const [isRotatingNodeId, setIsRotatingNodeId] = useState<string | null>(null);
    const [selectedNodeHistory, setSelectedNodeHistory] = useState<NodeHistoryModalState | null>(null);
    const [isLoadingNodeHistory, setIsLoadingNodeHistory] = useState(false);
    const [nodeHistoryError, setNodeHistoryError] = useState<string | null>(null);

    // --- User Details Modal State ---
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
    const [userPayments, setUserPayments] = useState<AdminPayment[]>([]);
    const [isLoadingPayments, setIsLoadingPayments] = useState(false);
    const [userToMove, setUserToMove] = useState<AdminUser | null>(null);
    const [destinationNodeId, setDestinationNodeId] = useState('');
    const [isMovingUser, setIsMovingUser] = useState(false);
    const [moveUserError, setMoveUserError] = useState<string | null>(null);

    const formatBytes = (bytes: number | null | undefined) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const copyToClipboard = async (value: string, feedbackKey: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedValue(feedbackKey);
            window.setTimeout(() => setCopiedValue((current) => (current === feedbackKey ? null : current)), 2000);
        } catch (err) {
            console.error('Failed to copy to clipboard', err);
        }
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
            if (activeTab === 'users') {
                const params = new URLSearchParams({
                    page: currentPage.toString(),
                    limit: '20',
                    search: debouncedSearchQuery,
                    tier: tierFilter
                });
                const [usersRes, nodesRes] = await Promise.all([
                    fetch(buildApiUrl(`/api/admin/users?${params.toString()}`), {
                        credentials: 'include',
                    }),
                    fetch(buildApiUrl('/api/admin/nodes'), {
                        credentials: 'include',
                    }),
                ]);

                if ([usersRes.status, nodesRes.status].some((status) => status === 401 || status === 403)) {
                    await refreshSession();
                    return;
                }

                const [usersData, nodesData] = await Promise.all([
                    usersRes.json(),
                    nodesRes.json(),
                ]);
                setUsers(usersData.users || []);
                setTotalPages(usersData.totalPages || 1);
                setTotalUsers(usersData.total || 0);
                setNodes(nodesData.nodes || []);
            } else {
                const res = await fetch(buildApiUrl('/api/admin/nodes'), {
                    credentials: 'include',
                });
                if (res.status === 401 || res.status === 403) {
                    await refreshSession();
                    return;
                }
                const data = await res.json();
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
            await fetch(buildApiUrl(`/api/admin/users/${userId}/block`), {
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
            const res = await fetch(buildApiUrl(`/api/admin/users/${user.id}/payments`), {
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
        setAddNodeError(null);
        setNodeActionError(null);
        try {
            const res = await fetch(buildApiUrl('/api/admin/nodes'), {
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

            const data = await res.json();
            if (res.ok) {
                setShowAddNode(false);
                setNewNodeName('');
                setNewNodeIp('');
                setNodeCredentials({
                    nodeId: data.nodeId,
                    agentToken: data.agentToken,
                    nodeName: newNodeName,
                    source: 'created',
                });
                fetchData();
            } else {
                setAddNodeError(data.error || "Failed to add node");
            }
        } catch (err) {
            setAddNodeError("Network error registering node");
        } finally {
            setIsAddingNode(false);
        }
    };

    const handleRotateNodeToken = async (node: AdminNode) => {
        setNodeActionError(null);
        setIsRotatingNodeId(node.id);

        try {
            const res = await fetch(buildApiUrl(`/api/admin/nodes/${node.id}/rotate-token`), {
                method: 'POST',
                credentials: 'include',
            });

            if (res.status === 401 || res.status === 403) {
                await refreshSession();
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                setNodeActionError(data.error || 'Failed to rotate node token');
                return;
            }

            setNodeCredentials({
                nodeId: data.nodeId,
                agentToken: data.agentToken,
                nodeName: node.name,
                source: 'rotated',
            });
            setNodes((current) => current.map((candidate) => (
                candidate.id === node.id
                    ? { ...candidate, agentTokenConfigured: 1 }
                    : candidate
            )));
            fetchData();
        } catch (err) {
            console.error('Failed to rotate node token', err);
            setNodeActionError('Network error rotating node token');
        } finally {
            setIsRotatingNodeId(null);
        }
    };

    const openNodeHistory = async (node: AdminNode) => {
        setSelectedNodeHistory({
            nodeId: node.id,
            nodeName: node.name,
            history: [],
        });
        setNodeHistoryError(null);
        setIsLoadingNodeHistory(true);

        try {
            const res = await fetch(buildApiUrl(`/api/admin/nodes/${node.id}/ip-history?limit=20`), {
                credentials: 'include',
            });

            if (res.status === 401 || res.status === 403) {
                await refreshSession();
                setSelectedNodeHistory(null);
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                setNodeHistoryError(data.error || 'Failed to load IP history');
                return;
            }

            setSelectedNodeHistory({
                nodeId: data.nodeId,
                nodeName: data.nodeName,
                history: data.history || [],
            });
        } catch (err) {
            console.error('Failed to load node IP history', err);
            setNodeHistoryError('Network error loading IP history');
        } finally {
            setIsLoadingNodeHistory(false);
        }
    };

    const openMoveUserModal = (user: AdminUser) => {
        const firstAvailableDestination = nodes.find((node) => node.status === 'active' && node.id !== user.nodeId);
        setUserToMove(user);
        setDestinationNodeId(firstAvailableDestination?.id || '');
        setMoveUserError(null);
    };

    const handleMoveUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userToMove || !destinationNodeId) {
            setMoveUserError('Select an active destination node.');
            return;
        }

        setIsMovingUser(true);
        setMoveUserError(null);

        try {
            const res = await fetch(buildApiUrl(`/api/admin/users/${userToMove.id}/move`), {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain'
                },
                credentials: 'include',
                body: JSON.stringify({ nodeId: destinationNodeId }),
            });

            if (res.status === 401 || res.status === 403) {
                await refreshSession();
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                setMoveUserError(data.error || 'Failed to move user');
                return;
            }

            setSelectedUser((current) => (
                current && current.id === userToMove.id
                    ? {
                        ...current,
                        nodeId: data.allocation.nodeId,
                        port: data.allocation.port,
                        nodeName: data.allocation.nodeName,
                        nodePublicIp: data.allocation.nodePublicIp,
                    }
                    : current
            ));
            setUserToMove(null);
            setDestinationNodeId('');
            await fetchData();
        } catch (err) {
            console.error("Failed to move user", err);
            setMoveUserError('Network error moving user');
        } finally {
            setIsMovingUser(false);
        }
    };

    const moveTargetOptions = userToMove
        ? nodes.filter((node) => node.status === 'active' && node.id !== userToMove.nodeId)
        : [];

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
                            {activeTab === 'users' ? (
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
                                    <div className="relative overflow-x-auto rounded-lg border border-gray-700 bg-gray-800 min-h-[400px]">
                                        {isLoading && (
                                            <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center text-gray-400 rounded-lg">
                                                <Activity size={32} className="animate-spin mb-4 text-blue-500" />
                                                <p>Loading users...</p>
                                            </div>
                                        )}
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
                                                {users.length === 0 && !isLoading ? (
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
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center space-x-1">
                                                                        <MonitorPlay size={14} className="text-green-500" />
                                                                        <span className="text-gray-200">{user.nodeName || user.nodeId}</span>
                                                                    </div>
                                                                    <div className="text-xs text-gray-500 font-mono">{user.nodePublicIp || user.nodeId}</div>
                                                                    <div className="text-xs text-gray-500">Port: {user.port}</div>
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
                                                                    onClick={() => openMoveUserModal(user)}
                                                                    disabled={!user.nodeId || !nodes.some((node) => node.status === 'active' && node.id !== user.nodeId)}
                                                                    className="px-3 py-1.5 rounded text-xs font-medium border bg-amber-500/10 border-amber-500/20 text-amber-300 hover:bg-amber-500 hover:text-white transition-colors flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-500/10 disabled:hover:text-amber-300"
                                                                >
                                                                    <Server size={14} />
                                                                    <span>Move Node</span>
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
                                <div className="relative overflow-x-auto min-h-[400px]">
                                    {nodeActionError && (
                                        <div className="mx-4 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                            {nodeActionError}
                                        </div>
                                    )}
                                    {isLoading && (
                                        <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center text-gray-400">
                                            <Activity size={32} className="animate-spin mb-4 text-blue-500" />
                                            <p>Loading nodes...</p>
                                        </div>
                                    )}
                                    <table className="w-full text-left text-sm text-gray-300">
                                        <thead className="bg-gray-900/50 text-xs uppercase text-gray-400 border-b border-gray-700">
                                            <tr>
                                                <th className="px-6 py-4 font-medium">Server Name / IP</th>
                                                <th className="px-6 py-4 font-medium">Status</th>
                                                <th className="px-6 py-4 font-medium">Client Load</th>
                                                <th className="px-6 py-4 font-medium">Last Seen</th>
                                                <th className="px-6 py-4 font-medium text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-700/50">
                                            {nodes.length === 0 && !isLoading ? (
                                                <tr><td colSpan={5} className="text-center py-8 text-gray-500">No nodes found</td></tr>
                                            ) : nodes.map(node => (
                                                <tr key={node.id} className="hover:bg-gray-700/20 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="font-medium text-gray-200">{node.name}</div>
                                                        <div className="text-xs text-gray-400 mt-0.5 font-mono">{node.publicIp}</div>
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            {node.ipUpdatedAt ? `IP updated ${new Date(node.ipUpdatedAt).toLocaleString()}` : 'IP has not changed since registration'}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={clsx("inline-flex px-2 py-1 rounded-full text-xs font-medium border",
                                                            node.status === 'active' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                                                                node.status === 'provisioning' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                                    "bg-red-500/10 text-red-400 border-red-500/20"
                                                        )}>
                                                            {node.status.toUpperCase()}
                                                        </span>
                                                        <div className="text-xs text-gray-500 mt-2">
                                                            {node.agentTokenConfigured ? 'Agent token issued' : 'Needs token provisioning'}
                                                        </div>
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
                                                    <td className="px-6 py-4 text-xs text-gray-400">
                                                        <div>{node.lastPing ? new Date(node.lastPing).toLocaleString() : 'Never'}</div>
                                                        <div className="mt-1 text-gray-500">CPU load {node.cpuLoad.toFixed(2)}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => handleRotateNodeToken(node)}
                                                                disabled={isRotatingNodeId === node.id}
                                                                className="px-3 py-1.5 rounded text-xs font-medium border bg-blue-500/10 border-blue-500/20 text-blue-300 hover:bg-blue-500 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {isRotatingNodeId === node.id
                                                                    ? 'Issuing...'
                                                                    : node.agentTokenConfigured
                                                                        ? 'Rotate Token'
                                                                        : 'Provision Token'}
                                                            </button>
                                                            <button
                                                                onClick={() => openNodeHistory(node)}
                                                                className="px-3 py-1.5 rounded text-xs font-medium border bg-gray-700/60 border-gray-600 text-gray-200 hover:bg-gray-600 transition-colors"
                                                            >
                                                                IP History
                                                            </button>
                                                        </div>
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

            {/* Mobile Bottom Navigation */}
            <div className="md:hidden border-t border-gray-700 bg-gray-800/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)] flex items-center justify-around sticky bottom-0 z-40">
                <button
                    onClick={() => setActiveTab('users')}
                    className={clsx(
                        "flex flex-col items-center justify-center pt-3 pb-2 flex-1 transition-colors",
                        activeTab === 'users' ? "text-blue-400" : "text-gray-400 hover:text-gray-200"
                    )}
                >
                    <Users size={20} />
                    <span className="text-[10px] mt-1 font-medium tracking-wide">Users</span>
                </button>
                <button
                    onClick={() => setActiveTab('nodes')}
                    className={clsx(
                        "flex flex-col items-center justify-center pt-3 pb-2 flex-1 transition-colors",
                        activeTab === 'nodes' ? "text-blue-400" : "text-gray-400 hover:text-gray-200"
                    )}
                >
                    <Server size={20} />
                    <span className="text-[10px] mt-1 font-medium tracking-wide">Nodes</span>
                </button>
                <button
                    onClick={() => setActiveTab('monitoring')}
                    className={clsx(
                        "flex flex-col items-center justify-center pt-3 pb-2 flex-1 transition-colors",
                        activeTab === 'monitoring' ? "text-blue-400" : "text-gray-400 hover:text-gray-200"
                    )}
                >
                    <MonitorPlay size={20} />
                    <span className="text-[10px] mt-1 font-medium tracking-wide">Monitoring</span>
                </button>
            </div>

            {/* Add Node Modal overlay */}
            {showAddNode && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold text-white mb-2">Register Proxy Node</h3>
                        <p className="text-gray-400 text-sm mb-6">
                            Adds a new VPS server to the pool. You must still run the <code className="text-blue-400">setup_proxy_node.sh</code> script on the target machine.
                        </p>

                        {addNodeError && (
                            <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-3 rounded-lg text-sm">
                                {addNodeError}
                            </div>
                        )}

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

            {nodeCredentials && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-white">
                                    {nodeCredentials.source === 'created' ? 'Node Credentials' : 'Rotated Node Credentials'}
                                </h3>
                                <p className="text-gray-400 text-sm mt-2">
                                    Save these values now for <span className="text-white">{nodeCredentials.nodeName}</span>. The agent token is only shown in this response.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setNodeCredentials(null)}
                                className="text-gray-400 hover:text-white transition p-2 hover:bg-gray-700 rounded-lg"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                            Keep <code className="text-amber-100">X-Agent-Secret</code> configured during the transition period. These values add the stable per-node identity on top of the shared secret.
                        </div>

                        <div className="mt-6 grid gap-4 md:grid-cols-2">
                            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
                                <div className="text-xs uppercase tracking-wide text-gray-500">Node ID</div>
                                <div className="mt-2 font-mono text-sm text-white break-all">{nodeCredentials.nodeId}</div>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(nodeCredentials.nodeId, 'node-id')}
                                    className="mt-3 rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700 transition-colors"
                                >
                                    {copiedValue === 'node-id' ? 'Copied' : 'Copy Node ID'}
                                </button>
                            </div>
                            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
                                <div className="text-xs uppercase tracking-wide text-gray-500">Agent Token</div>
                                <div className="mt-2 font-mono text-sm text-white break-all">{nodeCredentials.agentToken}</div>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(nodeCredentials.agentToken, 'agent-token')}
                                    className="mt-3 rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700 transition-colors"
                                >
                                    {copiedValue === 'agent-token' ? 'Copied' : 'Copy Agent Token'}
                                </button>
                            </div>
                        </div>

                        <div className="mt-6 rounded-lg border border-gray-700 bg-gray-900/60 p-4">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="text-xs uppercase tracking-wide text-gray-500">Environment Snippet</div>
                                    <p className="mt-1 text-xs text-gray-400">Use this in <code className="text-blue-300">/etc/superproxy/agent.env</code>.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(`NODE_ID=${nodeCredentials.nodeId}\nAGENT_TOKEN=${nodeCredentials.agentToken}`, 'env-snippet')}
                                    className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500 hover:text-white transition-colors"
                                >
                                    {copiedValue === 'env-snippet' ? 'Copied' : 'Copy Snippet'}
                                </button>
                            </div>
                            <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-950/80 p-4 text-xs text-gray-200">{`NODE_ID=${nodeCredentials.nodeId}
AGENT_TOKEN=${nodeCredentials.agentToken}`}</pre>
                        </div>
                    </div>
                </div>
            )}

            {selectedNodeHistory && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-white">IP History</h3>
                                <p className="text-gray-400 text-sm mt-2">
                                    Recent public IP changes for <span className="text-white">{selectedNodeHistory.nodeName}</span>.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedNodeHistory(null)}
                                className="text-gray-400 hover:text-white transition p-2 hover:bg-gray-700 rounded-lg"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {isLoadingNodeHistory ? (
                            <div className="py-10 flex flex-col items-center justify-center text-gray-400">
                                <Activity size={28} className="animate-spin mb-4 text-blue-500" />
                                <p>Loading node history...</p>
                            </div>
                        ) : nodeHistoryError ? (
                            <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                {nodeHistoryError}
                            </div>
                        ) : selectedNodeHistory.history.length === 0 ? (
                            <div className="mt-6 rounded-lg border border-gray-700 bg-gray-900/50 px-4 py-6 text-sm text-gray-400">
                                No IP changes recorded for this node yet.
                            </div>
                        ) : (
                            <div className="mt-6 overflow-hidden rounded-lg border border-gray-700">
                                <table className="w-full text-left text-sm text-gray-300">
                                    <thead className="bg-gray-900/50 text-xs uppercase text-gray-400 border-b border-gray-700">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Changed At</th>
                                            <th className="px-4 py-3 font-medium">Previous IP</th>
                                            <th className="px-4 py-3 font-medium">New IP</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700/50 bg-gray-900/30">
                                        {selectedNodeHistory.history.map((entry) => (
                                            <tr key={entry.id}>
                                                <td className="px-4 py-3 text-gray-300">{new Date(entry.changedAt).toLocaleString()}</td>
                                                <td className="px-4 py-3 font-mono text-xs text-gray-400">{entry.previousIp || 'Unknown'}</td>
                                                <td className="px-4 py-3 font-mono text-xs text-white">{entry.newIp}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Move User Modal */}
            {userToMove && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-white">Move User To Another Node</h3>
                                <p className="text-gray-400 text-sm mt-2">
                                    Reassigns <span className="text-white">{userToMove.email}</span> to a different active node while preserving the existing VLESS UUID.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setUserToMove(null)}
                                className="text-gray-400 hover:text-white transition p-2 hover:bg-gray-700 rounded-lg"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                            The gateway still routes through a single backend origin. Only move users to the node currently serving <code className="text-amber-100">gw.blue2000.cc</code>.
                        </div>

                        {moveUserError && (
                            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                {moveUserError}
                            </div>
                        )}

                        <form onSubmit={handleMoveUser} className="mt-6 space-y-4">
                            <div className="rounded-lg border border-gray-700 bg-gray-900/50 px-4 py-3 text-sm text-gray-300">
                                <div className="flex justify-between gap-4">
                                    <span className="text-gray-500">Current Node</span>
                                    <span className="text-right">
                                        <span className="block text-white">{userToMove.nodeName || userToMove.nodeId}</span>
                                        <span className="block font-mono text-xs text-gray-500">{userToMove.nodePublicIp || 'Unknown IP'}</span>
                                    </span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Destination Node</label>
                                <select
                                    value={destinationNodeId}
                                    onChange={(e) => setDestinationNodeId(e.target.value)}
                                    disabled={moveTargetOptions.length === 0 || isMovingUser}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {moveTargetOptions.length === 0 ? (
                                        <option value="">No other active nodes available</option>
                                    ) : (
                                        moveTargetOptions.map((node) => (
                                            <option key={node.id} value={node.id}>
                                                {node.name} ({node.publicIp})
                                            </option>
                                        ))
                                    )}
                                </select>
                            </div>

                            <div className="flex justify-end space-x-3 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setUserToMove(null)}
                                    className="px-4 py-2 text-gray-400 hover:text-white transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isMovingUser || moveTargetOptions.length === 0 || !destinationNodeId}
                                    className="bg-amber-500 hover:bg-amber-400 text-gray-950 px-6 py-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isMovingUser ? 'Moving...' : 'Move User'}
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
                        <div className="px-6 py-4 border-b border-gray-700 bg-gray-800/80 sticky top-0 relative">
                            <button onClick={() => setSelectedUser(null)} className="absolute top-4 right-4 z-10 text-gray-400 hover:text-white transition p-2 hover:bg-gray-700 rounded-lg">
                                <X size={20} />
                            </button>
                            <div className="pr-11">
                                <h3 className="text-xl font-bold text-white flex items-start space-x-2">
                                    <span className="truncate block">{selectedUser.email}</span>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                        {selectedUser.tier.toUpperCase()}
                                    </span>
                                </h3>
                                <p className="text-gray-400 text-sm mt-1">ID: <span className="font-mono">{selectedUser.id}</span></p>
                            </div>
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
