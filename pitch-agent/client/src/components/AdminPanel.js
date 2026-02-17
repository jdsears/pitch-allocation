import React, { useState, useEffect } from 'react';
import {
  getReferees,
  addReferee,
  updateReferee,
  getVenues,
  importFixtures,
  getRequests,
  updateRequest,
} from '../utils/api';

export default function AdminPanel() {
  const [referees, setReferees] = useState([]);
  const [venues, setVenues] = useState([]);
  const [requests, setRequests] = useState([]);
  const [newRef, setNewRef] = useState({ name: '', phone: '' });
  const [importText, setImportText] = useState('');
  const [toast, setToast] = useState(null);
  const [activeSection, setActiveSection] = useState('referees');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [refsRes, venuesRes, reqRes] = await Promise.all([
        getReferees(),
        getVenues(),
        getRequests('pending'),
      ]);
      setReferees(refsRes.data);
      setVenues(venuesRes.data);
      setRequests(reqRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddRef = async (e) => {
    e.preventDefault();
    if (!newRef.name) return;
    try {
      await addReferee(newRef);
      setNewRef({ name: '', phone: '' });
      showToast('Referee added');
      loadData();
    } catch (err) {
      showToast('Failed to add ref', 'error');
    }
  };

  const handleToggleRef = async (ref) => {
    try {
      await updateReferee(ref.id, { active: !ref.active });
      loadData();
    } catch (err) {
      showToast('Update failed', 'error');
    }
  };

  const handleImport = async () => {
    try {
      // Parse CSV-like input: date, kick_off, home_team, away_team, age_group, gender
      const lines = importText.trim().split('\n').filter(l => l.trim());
      const fixtures = lines.map(line => {
        const parts = line.split(',').map(s => s.trim());
        const ageGroup = parts[4] || '';
        const formatMap = { U6: '5v5', U7: '5v5', U8: '5v5', U9: '7v7', U10: '7v7', U11: '9v9', U12: '9v9', U13: '11v11', U14: '11v11', U15: '11v11', U16: '11v11', U17: '11v11', U18: '11v11' };
        return {
          match_date: parts[0],
          kick_off: parts[1] || null,
          home_team: parts[2],
          away_team: parts[3],
          age_group: ageGroup,
          gender: parts[5] || 'boys',
          format: formatMap[ageGroup] || '11v11',
          is_home_game: true,
          match_type: 'League / Cup',
        };
      });

      const res = await importFixtures(fixtures);
      showToast(`Imported ${res.data.saved} fixtures`);
      setImportText('');
    } catch (err) {
      showToast('Import failed - check format', 'error');
    }
  };

  const handleRequestAction = async (id, status) => {
    try {
      await updateRequest(id, { status });
      showToast(`Request ${status}`);
      loadData();
    } catch (err) {
      showToast('Update failed', 'error');
    }
  };

  return (
    <div>
      {/* Section tabs */}
      <div className="nav" style={{ marginBottom: 20 }}>
        {['referees', 'import', 'venues', 'requests'].map(s => (
          <button
            key={s}
            className={activeSection === s ? 'active' : ''}
            onClick={() => setActiveSection(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Referees */}
      {activeSection === 'referees' && (
        <div className="card">
          <div className="card-header">
            <h2>🏁 Referee Pool</h2>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {referees.filter(r => r.active).length} active
            </span>
          </div>

          <form onSubmit={handleAddRef} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              placeholder="Name"
              value={newRef.name}
              onChange={e => setNewRef({ ...newRef, name: e.target.value })}
              style={{ flex: 1 }}
            />
            <input
              placeholder="Phone (optional)"
              value={newRef.phone}
              onChange={e => setNewRef({ ...newRef, phone: e.target.value })}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary">Add</button>
          </form>

          <table className="grid-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {referees.map(ref => (
                <tr key={ref.id} style={{ opacity: ref.active ? 1 : 0.5 }}>
                  <td>{ref.name}</td>
                  <td>{ref.phone || '—'}</td>
                  <td>
                    <span className={`badge ${ref.active ? 'badge-green' : 'badge-red'}`}>
                      {ref.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => handleToggleRef(ref)}
                    >
                      {ref.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Import */}
      {activeSection === 'import' && (
        <div className="card">
          <div className="card-header">
            <h2>📥 Manual Fixture Import</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
            If the FA scraper can't reach the site, paste fixtures here. One per line:
          </p>
          <code style={{ display: 'block', background: 'var(--bg-input)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            YYYY-MM-DD, HH:MM, Home Team, Away Team, U13, boys
          </code>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={`2026-03-21, 10:00, Morley YFC U13 Stallions, Wymondham Town U13, U13, boys\n2026-03-21, 12:00, Morley YFC U10 Hawks, Hethersett U10, U10, boys`}
            style={{
              width: '100%',
              minHeight: 150,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: 12,
              borderRadius: 8,
              fontSize: 13,
              fontFamily: 'monospace',
              resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importText.trim()}>
              Import Fixtures
            </button>
          </div>
        </div>
      )}

      {/* Venues */}
      {activeSection === 'venues' && (
        <div className="card">
          <div className="card-header">
            <h2>📍 Venues & Pitches</h2>
          </div>
          {venues.map(venue => (
            <div key={venue.id} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{venue.name}</h3>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Pitch</th>
                    <th>Format</th>
                  </tr>
                </thead>
                <tbody>
                  {venue.pitches?.map(p => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td><span className="badge badge-blue">{p.format}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Requests */}
      {activeSection === 'requests' && (
        <div className="card">
          <div className="card-header">
            <h2>📋 Pending Requests</h2>
          </div>
          {requests.length === 0 ? (
            <div className="empty-state">
              <p>No pending requests</p>
            </div>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req.id}>
                    <td>{req.requested_by}</td>
                    <td><span className="badge badge-amber">{req.request_type}</span></td>
                    <td>{req.details}</td>
                    <td>{req.match_date}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-success" onClick={() => handleRequestAction(req.id, 'approved')}>
                          Approve
                        </button>
                        <button className="btn btn-sm btn-outline" onClick={() => handleRequestAction(req.id, 'rejected')}>
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
