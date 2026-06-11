import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { getAuthStatus, adminLogin, setAdminToken } from './utils/api';
import AllocationGrid from './components/AllocationGrid';
import OverviewGrid from './components/OverviewGrid';
import AdminPanel from './components/AdminPanel';
import CalendarView from './components/CalendarView';
import RefClaimPage from './pages/RefClaimPage';
import PublicCalendarPage from './pages/PublicCalendarPage';
import RequestForm from './components/RequestForm';
import MorleyCrest from './components/MorleyCrest';
import ThemeToggle from './components/ThemeToggle';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#ff4444', background: '#1a1a2e', minHeight: '100vh' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 12 }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#888', marginTop: 8 }}>
            {this.state.error.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Public pages - shared via WhatsApp link */}
          <Route path="/grid" element={<RefClaimPage />} />
          <Route path="/calendar" element={<PublicCalendarPage />} />
          <Route path="/request" element={<RequestForm />} />

          {/* Admin views for Guy */}
          <Route path="/*" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function AdminLogin({ onLoggedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminLogin(password);
      setAdminToken(res.data.token);
      onLoggedIn();
    } catch (err) {
      setError(err.response?.status === 401 ? 'Wrong password' : 'Login failed — try again');
    }
    setBusy(false);
  };

  return (
    <div className="card" style={{ maxWidth: 380, margin: '60px auto' }}>
      <div className="card-header"><h2>🔒 Admin login</h2></div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Enter the club admin password to manage fixtures, teams and allocations.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="password"
          autoFocus
          placeholder="Admin password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}

function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  // null = checking, true/false = resolved. If the server has no
  // ADMIN_PASSWORD set, auth is not required and everyone is admin.
  const [isAdmin, setIsAdmin] = useState(null);

  const checkAuth = async () => {
    try {
      const res = await getAuthStatus();
      setIsAdmin(!res.data.required || res.data.ok);
    } catch (err) {
      // If the status endpoint is unreachable, fail open for read-only
      // views; admin actions will still be rejected server-side.
      setIsAdmin(false);
    }
  };

  useEffect(() => { checkAuth(); }, []);

  const adminGated = (component) =>
    isAdmin === null ? null : isAdmin ? component : <AdminLogin onLoggedIn={checkAuth} />;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <MorleyCrest size={46} />
          <div className="brand-text">
            <h1><span>Morley YFC</span> Pitch Agent</h1>
            <div className="brand-sub">Morley Youth FC</div>
          </div>
        </div>
        <div className="header-actions">
          <nav className="nav">
            <button
              className={activeTab === 'overview' ? 'active' : ''}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={activeTab === 'grid' ? 'active' : ''}
              onClick={() => setActiveTab('grid')}
            >
              Weekly
            </button>
            <button
              className={activeTab === 'calendar' ? 'active' : ''}
              onClick={() => setActiveTab('calendar')}
            >
              Calendar
            </button>
            <button
              className={activeTab === 'admin' ? 'active' : ''}
              onClick={() => setActiveTab('admin')}
            >
              Admin
            </button>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      {activeTab === 'overview' && <OverviewGrid />}
      {activeTab === 'grid' && <AllocationGrid isAdmin={!!isAdmin} />}
      {activeTab === 'calendar' && <CalendarView />}
      {activeTab === 'admin' && adminGated(<AdminPanel />)}
    </div>
  );
}

export default App;
