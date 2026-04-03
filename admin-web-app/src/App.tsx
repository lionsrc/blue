import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { AuthContext, type AuthStatus } from './auth';
import { buildAdminAccessLoginUrl, buildApiUrl, isApiCrossOrigin } from './api';

export default function App() {
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const needsApiAccessLogin = isApiCrossOrigin();

  const refreshSession = async () => {
    setStatus('loading');
    setAuthError(null);
    try {
      const res = await fetch(buildApiUrl('/api/admin/session'), {
        credentials: 'include',
      });

      if (!res.ok) {
        setAdminEmail(null);
        const errorPayload = await res.json().catch(() => null) as { error?: string } | null;
        setAuthError(errorPayload?.error || `Access check failed with status ${res.status}`);
        setStatus('unauthenticated');
        return;
      }

      const data = await res.json();
      setAdminEmail(data.admin?.email || null);
      setAuthError(null);
      setStatus('authenticated');
    } catch (err) {
      console.error('Failed to refresh admin session', err);
      setAdminEmail(null);
      setAuthError('Unable to reach the admin API. Complete Cloudflare Access for the API origin, then try again.');
      setStatus('unauthenticated');
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const openAccessLogin = () => {
    if (!needsApiAccessLogin) {
      void refreshSession();
      return;
    }

    window.location.assign(buildAdminAccessLoginUrl(window.location.href));
  };

  const signOut = () => {
    setAdminEmail(null);
    setAuthError(null);
    setStatus('unauthenticated');
    window.location.assign('/cdn-cgi/access/logout');
  };

  return (
    <AuthContext.Provider value={{ adminEmail, status, authError, needsApiAccessLogin, refreshSession, openAccessLogin, signOut }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={status === 'authenticated' ? <Dashboard /> : <Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
