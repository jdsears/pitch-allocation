import React, { useState, useEffect } from 'react';
import {
  getReferees,
  addReferee,
  updateReferee,
  getVenues,
  importFixtures,
  importFixtureImage,
  getRequests,
  updateRequest,
  listTeams,
  addTeam,
  updateTeam,
  deleteTeam,
  syncTeamsFromFixtures,
  getRolloverPreview,
  applyRollover,
  scrapeFixtures,
  getScrapeStatus,
} from '../utils/api';
import ConfirmModal from './ConfirmModal';

const EMPTY_TEAM = { name: '', age_group: '', format: '', gender: 'boys', home_venue_id: '', default_camera: '' };

const selectStyle = {
  fontSize: 13,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  borderRadius: 7,
  width: '100%',
};

function FixtureCard({ row, onChange, onRemove, index, showRemove }) {
  return (
    <div style={{
      background: 'var(--bg-input)',
      borderRadius: 10,
      padding: 14,
      marginBottom: 10,
      border: '1px solid var(--border)',
    }}>
      {showRemove && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            className="btn btn-sm btn-outline"
            onClick={onRemove}
            style={{ padding: '2px 8px', color: 'var(--red)', fontSize: 11 }}
          >
            Remove
          </button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Date</label>
          <input
            type="date"
            value={row.match_date}
            onChange={e => onChange(index, 'match_date', e.target.value)}
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Kick-off</label>
          <input
            type="time"
            value={row.kick_off}
            onChange={e => onChange(index, 'kick_off', e.target.value)}
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Home Team</label>
        <input
          value={row.home_team}
          onChange={e => onChange(index, 'home_team', e.target.value)}
          placeholder="e.g. Morley YFC U9 Bluebirds"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Away Team</label>
        <input
          value={row.away_team}
          onChange={e => onChange(index, 'away_team', e.target.value)}
          placeholder="e.g. Hethersett Athletic"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Age Group</label>
          <select
            value={row.age_group}
            onChange={e => onChange(index, 'age_group', e.target.value)}
            style={selectStyle}
          >
            {['U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18'].map(ag => (
              <option key={ag} value={ag}>{ag}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Gender</label>
          <select
            value={row.gender}
            onChange={e => onChange(index, 'gender', e.target.value)}
            style={selectStyle}
          >
            <option value="boys">Boys</option>
            <option value="girls">Girls</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const [referees, setReferees] = useState([]);
  const [venues, setVenues] = useState([]);
  const [requests, setRequests] = useState([]);
  const [newRef, setNewRef] = useState({ name: '', phone: '' });
  const emptyFixture = { match_date: '', kick_off: '', home_team: '', away_team: '', age_group: 'U13', gender: 'boys' };
  const [manualRows, setManualRows] = useState([{ ...emptyFixture }]);
  const [toast, setToast] = useState(null);
  const [activeSection, setActiveSection] = useState('referees');
  const [ocrFile, setOcrFile] = useState(null);
  const [ocrGender, setOcrGender] = useState('boys');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrPreview, setOcrPreview] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [teams, setTeams] = useState([]);
  const [teamForm, setTeamForm] = useState(EMPTY_TEAM);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [rolloverPlan, setRolloverPlan] = useState(null);
  const [scrapeStatus, setScrapeStatus] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [scraping, setScraping] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Live-update the scrape panel: poll while it's open or a run is active,
  // so "Scrape now" and the daily sync show progress without manual refresh
  useEffect(() => {
    if (activeSection !== 'scrape' && !scrapeStatus?.running) return;
    const t = setInterval(loadScrapeStatus, 5000);
    return () => clearInterval(t);
  }, [activeSection, scrapeStatus?.running]);

  const loadData = async () => {
    try {
      const [refsRes, venuesRes, reqRes, teamsRes] = await Promise.all([
        getReferees(),
        getVenues(),
        getRequests('pending'),
        listTeams(),
      ]);
      setReferees(refsRes.data);
      setVenues(venuesRes.data);
      setRequests(reqRes.data);
      setTeams(teamsRes.data);
    } catch (err) {
      console.error(err);
    }
    loadScrapeStatus();
  };

  const loadScrapeStatus = async () => {
    try {
      const res = await getScrapeStatus();
      setScrapeStatus(res.data);
    } catch (err) {
      // status endpoint optional — ignore if unavailable
    }
  };

  const handleScrapeNow = async () => {
    setScraping(true);
    try {
      const res = await scrapeFixtures();
      if (res.data?.skipped) {
        showToast('A scrape was already in progress (daily sync or another admin) — status below tracks it', 'error');
      } else {
        showToast(`Scraped — ${res.data.saved} saved of ${res.data.total} found`);
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Scrape failed', 'error');
    }
    setScraping(false);
    loadScrapeStatus();
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

  const updateRow = (index, field, value) => {
    setManualRows(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const addRow = () => setManualRows(rows => [...rows, { ...emptyFixture }]);

  const removeRow = (index) => {
    setManualRows(rows => rows.length === 1 ? [{ ...emptyFixture }] : rows.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    try {
      const boysFormatMap = { U6: '5v5', U7: '5v5', U8: '5v5', U9: '7v7', U10: '7v7', U11: '9v9', U12: '9v9', U13: '11v11', U14: '11v11', U15: '11v11', U16: '11v11', U17: '11v11', U18: '11v11' };
      const girlsFormatMap = { ...boysFormatMap, U9: '5v5', U11: '7v7', U13: '9v9', U14: '9v9' };

      const valid = manualRows.filter(r => r.match_date && r.home_team && r.away_team);
      if (valid.length === 0) {
        showToast('Fill in at least date, home & away team', 'error');
        return;
      }

      const fixtures = valid.map(r => {
        const formatMap = r.gender === 'girls' ? girlsFormatMap : boysFormatMap;
        return {
          match_date: r.match_date,
          kick_off: r.kick_off || null,
          home_team: r.home_team,
          away_team: r.away_team,
          age_group: r.age_group,
          gender: r.gender,
          format: formatMap[r.age_group] || '11v11',
          is_home_game: true,
          match_type: 'League / Cup',
        };
      });

      const res = await importFixtures(fixtures);
      showToast(`Imported ${res.data.saved} fixture${res.data.saved !== 1 ? 's' : ''}`);
      setManualRows([{ ...emptyFixture }]);
    } catch (err) {
      showToast('Import failed', 'error');
    }
  };

  const handleOcrFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setOcrFile(file);
      setOcrResult(null);
      const reader = new FileReader();
      reader.onload = (ev) => setOcrPreview(ev.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleOcrImport = async () => {
    if (!ocrFile) return;
    setOcrLoading(true);
    setOcrResult(null);
    try {
      const res = await importFixtureImage(ocrFile, ocrGender);
      const { fixtures, saved } = res.data;
      setOcrResult({ fixtures, saved });
      if (saved > 0) {
        showToast(`Imported ${saved} fixtures from image`);
      } else if (fixtures.length === 0) {
        showToast('No fixtures found in image', 'error');
      } else {
        showToast(`Found ${fixtures.length} fixtures, ${saved} new`);
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      showToast(`OCR failed: ${msg}`, 'error');
      setOcrResult({ error: msg });
    } finally {
      setOcrLoading(false);
    }
  };

  const [approvingId, setApprovingId] = useState(null);
  const [approveFixture, setApproveFixture] = useState({});

  const startApprove = (req) => {
    setApprovingId(req.id);
    setApproveFixture({
      match_date: req.match_date ? req.match_date.substring(0, 10) : '',
      kick_off: req.kick_off ? req.kick_off.substring(0, 5) : '',
      home_team: '',
      away_team: 'Friendly',
      age_group: 'U9',
      gender: 'boys',
      format_override: req.pitch_format || '',
      match_type: req.request_type === 'friendly' ? 'Friendly' : 'League / Cup',
    });
  };

  const handleRequestAction = async (id, status, fixtureData) => {
    try {
      const payload = { status };
      if (status === 'approved' && fixtureData) {
        payload.fixture = fixtureData;
      }
      const res = await updateRequest(id, payload);
      if (res.data?.created_fixture) {
        showToast(`Request approved — fixture created`);
      } else {
        showToast(`Request ${status}`);
      }
      setApprovingId(null);
      loadData();
    } catch (err) {
      showToast('Update failed', 'error');
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
      showToast(err.response?.data?.error || 'Update failed', 'error');
    }
  };

  const removeTeam = (t) => {
    setConfirmAction({
      title: `Delete ${t.name}?`,
      message: 'This only removes the team record (overrides, home venue, camera) — its fixtures are kept.',
      confirmLabel: 'Delete team',
      onConfirm: async () => {
        setConfirmAction(null);
        try {
          await deleteTeam(t.id);
          showToast('Team deleted');
          loadData();
        } catch (err) {
          showToast('Delete failed', 'error');
        }
      },
    });
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

  const validCount = manualRows.filter(r => r.match_date && r.home_team && r.away_team).length;

  return (
    <div>
      {/* Section tabs */}
      <div className="nav" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        {['referees', 'teams', 'scrape', 'import', 'venues', 'requests'].map(s => (
          <button
            key={s}
            className={activeSection === s ? 'active' : ''}
            onClick={() => setActiveSection(s)}
            style={{ position: 'relative' }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s === 'requests' && requests.length > 0 && (
              <span style={{
                position: 'absolute',
                top: -4,
                right: -4,
                background: 'var(--red)',
                color: 'white',
                borderRadius: '50%',
                width: 18,
                height: 18,
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {requests.length}
              </span>
            )}
          </button>
        ))}
      </div>

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

      {/* Destructive-action confirmation */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
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
              <button className="btn btn-primary" onClick={confirmRollover}>
                Apply — promote {rolloverPlan.filter(p => p.change === 'promote').length}, archive {rolloverPlan.filter(p => p.change === 'archive').length}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Referees */}
      {activeSection === 'referees' && (
        <div className="card">
          <div className="card-header">
            <h2>Referee Pool</h2>
            <span className="badge badge-blue">
              {referees.filter(r => r.active).length} active
            </span>
          </div>

          <form onSubmit={handleAddRef} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              placeholder="Name"
              value={newRef.name}
              onChange={e => setNewRef({ ...newRef, name: e.target.value })}
              style={{ flex: '1 1 120px', minWidth: 0 }}
            />
            <input
              placeholder="Phone (optional)"
              value={newRef.phone}
              onChange={e => setNewRef({ ...newRef, phone: e.target.value })}
              style={{ flex: '1 1 120px', minWidth: 0 }}
            />
            <button type="submit" className="btn btn-primary" style={{ flexShrink: 0 }}>Add</button>
          </form>

          {referees.map(ref => (
            <div
              key={ref.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: '1px solid var(--border)',
                opacity: ref.active ? 1 : 0.5,
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{ref.name}</div>
                {ref.phone && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ref.phone}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${ref.active ? 'badge-green' : 'badge-red'}`}>
                  {ref.active ? 'Active' : 'Inactive'}
                </span>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => handleToggleRef(ref)}
                >
                  {ref.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scrape from FA */}
      {activeSection === 'scrape' && (
        <div className="card">
          <div className="card-header">
            <h2>Scrape FA Full-Time</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            FA Full-Time blocks cloud servers, so scraping runs on your computer.
            Download the script below, double-click it, and fixtures will be imported automatically.
          </p>

          {/* Automatic daily scrape status */}
          <div style={{ background: 'var(--bg-input)', padding: 16, borderRadius: 8, marginBottom: 20 }}>
            <div className="card-header" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                Automatic daily sync
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-outline" onClick={loadScrapeStatus}>Refresh</button>
                <button className="btn btn-sm btn-primary" onClick={handleScrapeNow} disabled={scraping || scrapeStatus?.running}>
                  {scraping || scrapeStatus?.running ? '⏳ Scraping…' : 'Scrape now'}
                </button>
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 10 }}>
              Fixtures are scraped automatically every morning at 06:00 (UK). You can also run it now.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13 }}>
              <span className="badge badge-blue">
                Last run: {scrapeStatus?.lastRunAt ? new Date(scrapeStatus.lastRunAt).toLocaleString() : 'never'}
              </span>
              {scrapeStatus?.lastSource && (
                <span className="badge badge-amber">via {scrapeStatus.lastSource}</span>
              )}
              {scrapeStatus?.lastResult && (
                <span className="badge badge-green">
                  {scrapeStatus.lastResult.saved} saved / {scrapeStatus.lastResult.total} found
                </span>
              )}
              {scrapeStatus?.lastError && (
                <span className="badge badge-red" title={scrapeStatus.lastError}>
                  Last error: {String(scrapeStatus.lastError).slice(0, 60)}
                </span>
              )}
            </div>
            {scrapeStatus?.lastError && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>
                The cloud server may be blocked by FA Full-Time. If this keeps failing, use the
                downloadable script below instead.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <a
              href="/api/fixtures/scrape-script?platform=mac"
              download="morley-scrape.command"
              className="btn btn-primary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              Download for Mac
            </a>
            <a
              href="/api/fixtures/scrape-script?platform=windows"
              download="morley-scrape.ps1"
              className="btn btn-primary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              Download for Windows
            </a>
          </div>

          {/* Node.js Installation */}
          <div style={{ background: 'var(--bg-input)', padding: 16, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>Step 1: Install Node.js (if you don't have it)</h3>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <p style={{ marginBottom: 8 }}>The scrape script requires Node.js. Check if it's installed by opening Terminal (Mac) or PowerShell (Windows) and typing: <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>node --version</code></p>

              <p><strong>Mac:</strong></p>
              <ol style={{ paddingLeft: 20, margin: '4px 0 12px' }}>
                <li>Go to <a href="https://nodejs.org" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>nodejs.org</a></li>
                <li>Click the <strong>LTS</strong> (recommended) download button</li>
                <li>Open the downloaded <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>.pkg</code> file and follow the installer</li>
                <li>Restart Terminal if it was open</li>
              </ol>

              <p><strong>Windows:</strong></p>
              <ol style={{ paddingLeft: 20, margin: '4px 0' }}>
                <li>Go to <a href="https://nodejs.org" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>nodejs.org</a></li>
                <li>Click the <strong>LTS</strong> (recommended) download button</li>
                <li>Run the downloaded <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>.msi</code> installer, accept defaults</li>
                <li>Restart PowerShell if it was open</li>
              </ol>
            </div>
          </div>

          {/* Running the Script */}
          <div style={{ background: 'var(--bg-input)', padding: 16, borderRadius: 8, fontSize: 13 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>Step 2: Run the Scrape Script</h3>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <p style={{ marginBottom: 4 }}><strong>Mac:</strong></p>
              <ol style={{ paddingLeft: 20, margin: '4px 0 12px' }}>
                <li>Download the <strong>.command</strong> file above</li>
                <li>Open Terminal and run: <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>chmod +x ~/Downloads/morley-scrape.command</code></li>
                <li><strong>Important:</strong> Don't double-click — instead <strong>right-click</strong> the file and select <strong>"Open"</strong></li>
                <li>If you see "macOS cannot verify the developer" — click <strong>"Open"</strong> in the dialog</li>
                <li>You only need to do this once. After that, double-click works fine.</li>
              </ol>

              <p style={{ marginBottom: 4 }}><strong>Windows:</strong></p>
              <ol style={{ paddingLeft: 20, margin: '4px 0' }}>
                <li>Download the <strong>.ps1</strong> file above</li>
                <li>Right-click the file and select <strong>"Run with PowerShell"</strong></li>
                <li>If prompted about execution policy, type <strong>Y</strong> and press Enter</li>
              </ol>

              <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                First run takes ~1 minute to download Chromium. Subsequent runs are faster.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Import */}
      {activeSection === 'import' && (
        <>
          {/* OCR Image Import */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h2>Import from Screenshot</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
              Take a screenshot of fixtures from FA Full-Time and upload it here. AI will extract the fixture data automatically.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              <input
                type="file"
                accept="image/*"
                onChange={handleOcrFileChange}
                style={{ fontSize: 13 }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={ocrGender}
                  onChange={e => setOcrGender(e.target.value)}
                  style={selectStyle}
                >
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
                <button
                  className="btn btn-primary"
                  onClick={handleOcrImport}
                  disabled={!ocrFile || ocrLoading}
                  style={{ flexShrink: 0 }}
                >
                  {ocrLoading ? 'Extracting...' : 'Extract & Import'}
                </button>
              </div>
            </div>

            {ocrPreview && (
              <div style={{ marginBottom: 12 }}>
                <img
                  src={ocrPreview}
                  alt="Fixture screenshot"
                  style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
            )}

            {ocrResult && ocrResult.error && (
              <div style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: 12, borderRadius: 8, fontSize: 13 }}>
                {ocrResult.error}
              </div>
            )}

            {ocrResult && ocrResult.fixtures && ocrResult.fixtures.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Found {ocrResult.fixtures.length} fixtures, {ocrResult.saved} saved:
                </p>
                {ocrResult.fixtures.map((f, i) => (
                  <div key={i} style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 13,
                  }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{f.home_team} vs {f.away_team}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {f.match_date} {f.kick_off ? `at ${f.kick_off}` : ''} {f.age_group ? `· ${f.age_group}` : ''}
                      </div>
                    </div>
                    <span className={`badge ${f.is_home_game ? 'badge-green' : 'badge-blue'}`}>
                      {f.is_home_game ? 'H' : 'A'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual Add */}
          <div className="card">
            <div className="card-header">
              <h2>Add Match Manually</h2>
            </div>

            {manualRows.map((row, idx) => (
              <FixtureCard
                key={idx}
                row={row}
                index={idx}
                onChange={updateRow}
                onRemove={() => removeRow(idx)}
                showRemove={manualRows.length > 1}
              />
            ))}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleImport} disabled={validCount === 0} style={{ flex: '1 1 auto' }}>
                Import {validCount} Fixture{validCount !== 1 ? 's' : ''}
              </button>
              <button className="btn btn-outline" onClick={addRow} style={{ flexShrink: 0 }}>
                + Add Another
              </button>
            </div>
          </div>
        </>
      )}

      {/* Venues */}
      {activeSection === 'venues' && (
        <div className="card">
          <div className="card-header">
            <h2>Venues & Pitches</h2>
          </div>
          {venues.map(venue => (
            <div key={venue.id} style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--accent)' }}>{venue.name}</h3>
              {venue.pitches?.map(p => (
                <div key={p.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 14 }}>{p.name}</span>
                  <span className="badge badge-blue">{p.format}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Requests */}
      {activeSection === 'requests' && (
        <div className="card">
          <div className="card-header">
            <h2>Pending Requests</h2>
            {requests.length > 0 && (
              <span className="badge badge-amber">{requests.length} pending</span>
            )}
          </div>
          {requests.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>&#10003;</div>
              <p>All caught up — no pending requests</p>
            </div>
          ) : (
            <div>
              {requests.map(req => (
                <div key={req.id} style={{
                  background: 'var(--bg-input)',
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 10,
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{req.requested_by}</div>
                      <span className="badge badge-amber" style={{ fontSize: 10 }}>{req.request_type}</span>
                    </div>
                    {req.match_date && (
                      <span className="badge badge-blue" style={{ fontSize: 11, flexShrink: 0 }}>
                        {req.match_date.substring(0, 10)}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
                    {req.details}
                  </p>
                  {req.kick_off && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                      Preferred KO: <strong style={{ color: 'var(--text-primary)' }}>{req.kick_off.substring(0, 5)}</strong>
                    </div>
                  )}
                  {req.pitch_format && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                      Pitch format: <strong style={{ color: 'var(--text-primary)' }}>{req.pitch_format}</strong>
                    </div>
                  )}

                  {approvingId === req.id ? (
                    <div style={{
                      background: 'var(--bg-primary)',
                      borderRadius: 8,
                      padding: 14,
                      marginTop: 8,
                      border: '1px solid var(--accent)',
                    }}>
                      <p style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 10, fontWeight: 600 }}>
                        Create fixture from this request:
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Date</label>
                          <input
                            type="date"
                            value={approveFixture.match_date}
                            onChange={e => setApproveFixture({ ...approveFixture, match_date: e.target.value })}
                            style={{ width: '100%', fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Kick-off</label>
                          <input
                            type="time"
                            value={approveFixture.kick_off}
                            onChange={e => setApproveFixture({ ...approveFixture, kick_off: e.target.value })}
                            style={{ width: '100%', fontSize: 13 }}
                          />
                        </div>
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Home Team</label>
                        <input
                          value={approveFixture.home_team}
                          onChange={e => setApproveFixture({ ...approveFixture, home_team: e.target.value })}
                          placeholder="e.g. Morley YFC U9 Bluebirds"
                          style={{ width: '100%', fontSize: 13 }}
                        />
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Away Team</label>
                        <input
                          value={approveFixture.away_team}
                          onChange={e => setApproveFixture({ ...approveFixture, away_team: e.target.value })}
                          placeholder="e.g. Hethersett Athletic"
                          style={{ width: '100%', fontSize: 13 }}
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Age</label>
                          <select
                            value={approveFixture.age_group}
                            onChange={e => setApproveFixture({ ...approveFixture, age_group: e.target.value })}
                            style={selectStyle}
                          >
                            {['U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18'].map(ag => (
                              <option key={ag} value={ag}>{ag}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Gender</label>
                          <select
                            value={approveFixture.gender}
                            onChange={e => setApproveFixture({ ...approveFixture, gender: e.target.value })}
                            style={selectStyle}
                          >
                            <option value="boys">Boys</option>
                            <option value="girls">Girls</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Format</label>
                          <select
                            value={approveFixture.format_override}
                            onChange={e => setApproveFixture({ ...approveFixture, format_override: e.target.value })}
                            style={selectStyle}
                          >
                            <option value="">Auto</option>
                            <option value="5v5">5v5</option>
                            <option value="7v7">7v7</option>
                            <option value="9v9">9v9</option>
                            <option value="11v11">11v11</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-success"
                          disabled={!approveFixture.match_date || !approveFixture.home_team || !approveFixture.away_team}
                          onClick={() => handleRequestAction(req.id, 'approved', approveFixture)}
                          style={{ flex: 1 }}
                        >
                          Confirm & Create Fixture
                        </button>
                        <button className="btn btn-outline" onClick={() => setApprovingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {req.request_type === 'friendly' ? (
                        <button className="btn btn-sm btn-success" onClick={() => startApprove(req)} style={{ flex: 1 }}>
                          Approve & Create Fixture
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-success" onClick={() => handleRequestAction(req.id, 'approved')} style={{ flex: 1 }}>
                          Approve
                        </button>
                      )}
                      <button className="btn btn-sm btn-outline" onClick={() => handleRequestAction(req.id, 'rejected')} style={{ color: 'var(--red)' }}>
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
