import React, { useState, useEffect } from 'react';
import {
  getReferees,
  addReferee,
  updateReferee,
  getVenues,
  importFixtures,
  getRequests,
  updateRequest,
  scrapeFixtures,
  getScrapeStatus,
  getTeams,
  addTeam,
  updateTeam,
  deleteTeam,
  syncTeamsFromFixtures,
  getRolloverPreview,
  applyRollover,
} from '../utils/api';

const EMPTY_TEAM = { name: '', age_group: '', format: '', gender: 'boys', home_venue_id: '', default_camera: '' };

export default function AdminPanel() {
  const [referees, setReferees] = useState([]);
  const [venues, setVenues] = useState([]);
  const [requests, setRequests] = useState([]);
  const [newRef, setNewRef] = useState({ name: '', phone: '' });
  const [importText, setImportText] = useState('');
  const [toast, setToast] = useState(null);
  const [activeSection, setActiveSection] = useState('referees');
  const [scrapeStatus, setScrapeStatus] = useState(null);
  const [scraping, setScraping] = useState(false);
  const [teams, setTeams] = useState([]);
  const [teamForm, setTeamForm] = useState(EMPTY_TEAM);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [rolloverPlan, setRolloverPlan] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadData();
    loadScrapeStatus();
  }, []);

  const loadScrapeStatus = async () => {
    try {
      const res = await getScrapeStatus();
      setScrapeStatus(res.data);
    } catch (err) {
      /* status endpoint optional — ignore */
    }
  };

  const handleScrape = async () => {
    setScraping(true);
    try {
      const res = await scrapeFixtures();
      if (res.data.skipped) {
        showToast('A scrape is already running', 'error');
      } else {
        showToast(`Scraped ${res.data.total} fixtures (${res.data.saved} saved)`);
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Scrape failed — check FA IDs', 'error');
    }
    setScraping(false);
    loadScrapeStatus();
  };

  const loadData = async () => {
    try {
      const [refsRes, venuesRes, reqRes, teamsRes] = await Promise.all([
        getReferees(),
        getVenues(),
        getRequests('pending'),
        getTeams(),
      ]);
      setReferees(refsRes.data);
      setVenues(venuesRes.data);
      setRequests(reqRes.data);
      setTeams(teamsRes.data);
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
      const res = await updateRequest(id, { status });
      if (status === 'approved' && res.data?.fixture) {
        const f = res.data.fixture;
        showToast(`Fixture created: ${f.home_team} v ${f.away_team}`);
      } else {
        showToast(`Request ${status}`);
      }
      loadData();
    } catch (err) {
      const msg = err.response?.data?.error || 'Update failed';
      showToast(msg, 'error');
    }
  };

  const submitTeam = async (e) => {
    e.preventDefault();
    if (!teamForm.name.trim()) return;
    const payload = {
      ...teamForm,
      home_venue_id: teamForm.home_venue_id || null,
      format: teamForm.format || null,
      default_camera: teamForm.default_camera || null,
    };
    try {
      if (editingTeamId) {
        await updateTeam(editingTeamId, payload);
        showToast('Team updated');
      } else {
        await addTeam(payload);
        showToast('Team added');
      }
      setTeamForm(EMPTY_TEAM);
      setEditingTeamId(null);
      loadData();
    } catch (err) {
      showToast(err.response?.data?.error || 'Save failed', 'error');
    }
  };

  const editTeam = (t) => {
    setEditingTeamId(t.id);
    setTeamForm({
      name: t.name,
      age_group: t.age_group || '',
      format: t.format || '',
      gender: t.gender || 'boys',
      home_venue_id: t.home_venue_id || '',
      default_camera: t.default_camera || '',
    });
  };

  const cancelEditTeam = () => {
    setEditingTeamId(null);
    setTeamForm(EMPTY_TEAM);
  };

  const toggleTeamActive = async (t) => {
    try {
      await updateTeam(t.id, { active: !t.active });
      loadData();
    } catch (err) {
      const msg = err.response?.data?.error || 'Update failed';
      showToast(msg, 'error');
    }
  };

  const removeTeam = async (t) => {
    if (!window.confirm(`Delete ${t.name}? This only removes the team record, not its fixtures.`)) return;
    try {
      await deleteTeam(t.id);
      showToast('Team deleted');
      loadData();
    } catch (err) {
      showToast('Delete failed', 'error');
    }
  };

  const handleSyncTeams = async () => {
    setSyncing(true);
    try {
      const res = await syncTeamsFromFixtures();
      showToast(`Synced — ${res.data.added} new team(s) from ${res.data.scanned} found`);
      loadData();
    } catch (err) {
      showToast('Sync failed', 'error');
    }
    setSyncing(false);
  };

  const openRollover = async () => {
    try {
      const res = await getRolloverPreview();
      setRolloverPlan(res.data.plan);
    } catch (err) {
      showToast('Could not load rollover preview', 'error');
    }
  };

  const confirmRollover = async () => {
    try {
      const res = await applyRollover();
      showToast(`Rollover applied — ${res.data.promoted} promoted, ${res.data.archived} archived`);
      setRolloverPlan(null);
      loadData();
    } catch (err) {
      showToast('Rollover failed', 'error');
    }
  };

  return (
    <div>
      {/* Section tabs */}
      <div className="nav" style={{ marginBottom: 20 }}>
        {['referees', 'teams', 'import', 'venues', 'requests'].map(s => (
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

      {/* Teams */}
      {activeSection === 'teams' && (
        <div className="card">
          <div className="card-header">
            <h2>👕 Teams</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-outline" onClick={handleSyncTeams} disabled={syncing}>
                {syncing ? '⏳ Syncing…' : 'Sync from fixtures'}
              </button>
              <button className="btn btn-sm btn-primary" onClick={openRollover}>
                Season rollover →
              </button>
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            Teams are matched to scraped fixtures by name. Set a home venue or format
            override to steer allocation; a default camera pre-fills new allocations.
          </p>

          <form onSubmit={submitTeam} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <input
              placeholder="Team name (must match FA name)"
              value={teamForm.name}
              onChange={e => setTeamForm({ ...teamForm, name: e.target.value })}
              style={{ flex: '2 1 220px' }}
            />
            <input
              placeholder="Age (U13)"
              value={teamForm.age_group}
              onChange={e => setTeamForm({ ...teamForm, age_group: e.target.value })}
              style={{ flex: '1 1 80px' }}
            />
            <select
              value={teamForm.format}
              onChange={e => setTeamForm({ ...teamForm, format: e.target.value })}
              style={{ flex: '1 1 110px' }}
            >
              <option value="">Format (auto)</option>
              <option value="5v5">5v5</option>
              <option value="7v7">7v7</option>
              <option value="9v9">9v9</option>
              <option value="11v11">11v11</option>
            </select>
            <select
              value={teamForm.gender}
              onChange={e => setTeamForm({ ...teamForm, gender: e.target.value })}
              style={{ flex: '1 1 90px' }}
            >
              <option value="boys">Boys</option>
              <option value="girls">Girls</option>
            </select>
            <select
              value={teamForm.home_venue_id}
              onChange={e => setTeamForm({ ...teamForm, home_venue_id: e.target.value })}
              style={{ flex: '1 1 130px' }}
            >
              <option value="">Home venue (any)</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input
              placeholder="Default camera"
              value={teamForm.default_camera}
              onChange={e => setTeamForm({ ...teamForm, default_camera: e.target.value })}
              style={{ flex: '1 1 120px' }}
            />
            <button type="submit" className="btn btn-primary">
              {editingTeamId ? 'Save' : 'Add'}
            </button>
            {editingTeamId && (
              <button type="button" className="btn btn-outline" onClick={cancelEditTeam}>Cancel</button>
            )}
          </form>

          {teams.length === 0 ? (
            <div className="empty-state"><p>No teams yet — add one or sync from fixtures.</p></div>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Age</th>
                  <th>Format</th>
                  <th>Gender</th>
                  <th>Home venue</th>
                  <th>Camera</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {teams.map(t => (
                  <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                    <td>{t.name}</td>
                    <td>{t.age_group || '—'}</td>
                    <td><span className="badge badge-blue">{t.format || '—'}</span></td>
                    <td>{t.gender}</td>
                    <td>{t.home_venue_name || '—'}</td>
                    <td>{t.default_camera || '—'}</td>
                    <td>
                      <span className={`badge ${t.active ? 'badge-green' : 'badge-red'}`}>
                        {t.active ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-outline" onClick={() => editTeam(t)}>Edit</button>
                        <button className="btn btn-sm btn-outline" onClick={() => toggleTeamActive(t)}>
                          {t.active ? 'Archive' : 'Restore'}
                        </button>
                        <button className="btn btn-sm btn-outline" onClick={() => removeTeam(t)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Season rollover modal */}
      {rolloverPlan && (
        <div className="modal-overlay" onClick={() => setRolloverPlan(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="card-header">
              <h2>🔁 New Season Rollover</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
              Every active team moves up one age group. U18s are archived. Review before applying.
            </p>
            <table className="grid-table">
              <thead>
                <tr><th>Team</th><th>Change</th><th>Result</th></tr>
              </thead>
              <tbody>
                {rolloverPlan.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>
                      <span className={`badge ${p.change === 'archive' ? 'badge-red' : p.change === 'promote' ? 'badge-green' : 'badge-amber'}`}>
                        {p.change}
                      </span>
                    </td>
                    <td>
                      {p.change === 'promote' && `${p.from} → ${p.new_age} (${p.new_name})`}
                      {p.change === 'archive' && 'Archived'}
                      {p.change === 'skip' && (p.reason || 'No change')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setRolloverPlan(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmRollover}>Apply rollover</button>
            </div>
          </div>
        </div>
      )}

      {/* Import */}
      {activeSection === 'import' && (
        <>
        {/* Auto-scrape status + manual trigger */}
        <div className="card">
          <div className="card-header">
            <h2>🔄 FA Full-Time Sync</h2>
            <button className="btn btn-primary btn-sm" onClick={handleScrape} disabled={scraping || scrapeStatus?.running}>
              {scraping || scrapeStatus?.running ? '⏳ Scraping…' : 'Scrape now'}
            </button>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
            Fixtures sync automatically on a schedule. You can also pull them on demand here.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13 }}>
            <span className="badge badge-blue">
              Last run: {scrapeStatus?.lastRunAt ? new Date(scrapeStatus.lastRunAt).toLocaleString() : 'never'}
            </span>
            {scrapeStatus?.lastResult && (
              <span className="badge badge-green">
                {scrapeStatus.lastResult.saved} saved / {scrapeStatus.lastResult.total} found
              </span>
            )}
            {scrapeStatus?.source && (
              <span className="badge badge-yellow">via {scrapeStatus.source}</span>
            )}
            {scrapeStatus?.lastError && (
              <span className="badge badge-red" title={scrapeStatus.lastError}>
                Last error: {scrapeStatus.lastError.slice(0, 60)}
              </span>
            )}
          </div>
        </div>

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
        </>
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
                          {['friendly', 'other'].includes(req.request_type) ? 'Approve & Create Fixture' : 'Approve'}
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
