import React, { useState, useEffect } from 'react';
import {
  listTeams,
  addTeam,
  updateTeam,
  deleteTeam,
  syncTeamsFromFixtures,
  getRolloverPreview,
  applyRollover,
} from '../../utils/api';
import ConfirmModal from '../ConfirmModal';

const EMPTY_TEAM = { name: '', age_group: '', format: '', gender: 'boys', home_venue_id: '', default_camera: '' };

/**
 * Admin ▸ Teams: CRUD, sync-from-fixtures and season rollover.
 * Owns its own data; parent supplies venues (shared) and showToast.
 */
export default function TeamsSection({ venues, showToast }) {
  const [teams, setTeams] = useState([]);
  const [teamForm, setTeamForm] = useState(EMPTY_TEAM);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [rolloverPlan, setRolloverPlan] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const loadTeams = async () => {
    try {
      const res = await listTeams();
      setTeams(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadTeams(); }, []);

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
      loadTeams();
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
      loadTeams();
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
          loadTeams();
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
      loadTeams();
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
      loadTeams();
    } catch (err) {
      showToast('Rollover failed', 'error');
    }
  };

  return (
    <>
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

    </>
  );
}
