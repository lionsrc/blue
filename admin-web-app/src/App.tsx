import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { AuthContext, type AuthStatus } from './auth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export default function App() {
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const refreshSession = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${API_URL}/api/admin/session`, {
        credentials: 'include',
      });

      if (!res.ok) {
        setAdminEmail(null);
        setStatus('unauthenticated');
        return;
      }

      const data = await res.json();
      setAdminEmail(data.admin?.email || null);
      setStatus('authenticated');
    } catch (err) {
      console.error('Failed to refresh admin session', err);
      setAdminEmail(null);
      setStatus('unauthenticated');
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const signOut = () => {
    setAdminEmail(null);
    setStatus('unauthenticated');
    window.location.assign('/cdn-cgi/access/logout');
  };

  return (
    <AuthContext.Provider value={{ adminEmail, status, refreshSession, signOut }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={status === 'authenticated' ? <Dashboard /> : <Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
