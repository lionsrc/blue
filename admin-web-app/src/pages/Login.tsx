import { RefreshCw } from 'lucide-react';
import { useAuth } from '../auth';

export default function Login() {
    const { status, refreshSession } = useAuth();
    const isChecking = status === 'loading';

    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-700">
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-blue-600/20 rounded-[20px] flex items-center justify-center mb-4 text-blue-500 shadow-xl shadow-blue-500/20 p-2">
                        <img src="/assets/logo.png" alt="Blue Lotus Network Logo" className="w-full h-full object-contain rounded-xl" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Blue Lotus Network Admin</h1>
                    <p className="text-gray-400 mt-2 text-center text-sm">
                        This portal is protected by Cloudflare Access.
                    </p>
                </div>

                <div className="space-y-6">
                    <div className="bg-gray-900/70 border border-gray-700 rounded-lg px-4 py-4 text-sm text-gray-300 leading-6">
                        {isChecking
                            ? 'Checking your Cloudflare Access session.'
                            : 'Sign in through the Cloudflare Access prompt for this site, then retry the access check if this screen remains visible.'}
                    </div>

                    <button
                        type="button"
                        onClick={() => void refreshSession()}
                        disabled={isChecking}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RefreshCw size={18} className={`mr-2 ${isChecking ? 'animate-spin' : ''}`} />
                        {isChecking ? 'Checking Access...' : 'Retry Access Check'}
                    </button>
                </div>
            </div>
        </div>
    );
}
