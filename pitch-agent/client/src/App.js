import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AllocationGrid from './components/AllocationGrid';
import AdminPanel from './components/AdminPanel';
import RefClaimPage from './pages/RefClaimPage';
import RequestForm from './components/RequestForm';
import MorleyCrest from './components/MorleyCrest';
import ThemeToggle from './components/ThemeToggle';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public ref claim page - shared via WhatsApp link */}
        <Route path="/grid" element={<RefClaimPage />} />
        <Route path="/request" element={<RequestForm />} />
        
        {/* Admin views for Guy */}
        <Route path="/*" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

function Dashboard() {
  const [activeTab, setActiveTab] = useState('grid');

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <MorleyCrest size={48} />
          <div className="brand-text">
            <h1><span>Morley YFC</span>&nbsp;Pitch Agent</h1>
            <div className="brand-sub">Fixture &amp; Referee Allocation</div>
          </div>
        </div>
        <div className="header-actions">
          <nav className="nav">
            <button
              className={activeTab === 'grid' ? 'active' : ''}
              onClick={() => setActiveTab('grid')}
            >
              Allocation Grid
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

      {activeTab === 'grid' && <AllocationGrid isAdmin={true} />}
      {activeTab === 'admin' && <AdminPanel />}
    </div>
  );
}

export default App;
