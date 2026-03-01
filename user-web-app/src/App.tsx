import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PaymentHistory from './pages/PaymentHistory';
import DeleteAccount from './pages/DeleteAccount';
import ChangeEmail from './pages/ChangeEmail';
import ChangePassword from './pages/ChangePassword';
import VerifyEmail from './pages/VerifyEmail';
import LanguageSwitcher from './components/LanguageSwitcher';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[#0a0a0a] text-slate-200 font-sans selection:bg-blue-500/30">
        <LanguageSwitcher />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login mode="login" />} />
          <Route path="/register" element={<Login mode="register" />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/history" element={<PaymentHistory />} />
          <Route path="/delete-account" element={<DeleteAccount />} />
          <Route path="/change-email" element={<ChangeEmail />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
