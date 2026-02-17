import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AllocationGrid from './components/AllocationGrid';
import OverviewGrid from './components/OverviewGrid';
import AdminPanel from './components/AdminPanel';
import RefClaimPage from './pages/RefClaimPage';
import RequestForm from './components/RequestForm';

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
          {/* Public ref claim page - shared via WhatsApp link */}
          <Route path="/grid" element={<RefClaimPage />} />
          <Route path="/request" element={<RequestForm />} />

          {/* Admin views for Guy */}
          <Route path="/*" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="app">
      <header className="header">
        <h1>
          ⚽ <span>Morley YFC</span> Pitch Agent
        </h1>
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
            className={activeTab === 'admin' ? 'active' : ''}
            onClick={() => setActiveTab('admin')}
          >
            Admin
          </button>
        </nav>
      </header>

      {activeTab === 'overview' && <OverviewGrid />}
      {activeTab === 'grid' && <AllocationGrid isAdmin={true} />}
      {activeTab === 'admin' && <AdminPanel />}
    </div>
  );
}

export default App;
