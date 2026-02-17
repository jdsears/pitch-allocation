import React, { useState, useEffect, useCallback } from 'react';
import { format, startOfWeek, addWeeks, subWeeks, addDays } from 'date-fns';
import {
  getAllocationGrid,
  generateAllocations,
  scrapeFixtures,
  publishAllocations,
  getAllocationSummary,
  updateAllocation,
  deleteAllocation,
  getReferees,
  claimMatch,
  unclaimMatch,
} from '../utils/api';
import { cleanTeamName, formatMatchDay } from '../utils/helpers';

export default function AllocationGrid({ isAdmin = false }) {
  const [weekDate, setWeekDate] = useState(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [grid, setGrid] = useState(null);
  const [summary, setSummary] = useState(null);
  const [referees, setReferees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [waPreview, setWaPreview] = useState(null);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadGrid = useCallback(async () => {
    setLoading(true);
    try {
      const [gridRes, summaryRes, refsRes] = await Promise.all([
        getAllocationGrid(weekDate),
        getAllocationSummary(weekDate),
        getReferees(),
      ]);
      setGrid(gridRes.data);
      setSummary(summaryRes.data);
      setReferees(refsRes.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [weekDate]);

  useEffect(() => { loadGrid(); }, [loadGrid]);

  const handleScrape = async () => {
    setLoading(true);
    try {
      const res = await scrapeFixtures();
      showToast(`Scraped ${res.data.total} fixtures (${res.data.saved} saved)`);
      loadGrid();
    } catch (err) {
      showToast('Scrape failed — check console', 'error');
    }
    setLoading(false);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await generateAllocations(weekDate);
      const c = res.data.conflicts || [];
      setConflicts(c);
      showToast(`Allocated ${res.data.allocated} fixtures${c.length ? `. ${c.length} conflicts.` : ''}`);
      loadGrid();
    } catch (err) {
      showToast('Allocation failed', 'error');
    }
    setLoading(false);
  };

  const handlePublish = async () => {
    try {
      const res = await publishAllocations(weekDate);
      setWaPreview(res.data.message);
      setShowPublishConfirm(false);
      showToast('Confirmed and WhatsApp message ready!');
      loadGrid();
    } catch (err) {
      showToast('Publish failed', 'error');
    }
  };

  const handleEdit = (allocation) => {
    setEditingId(allocation.allocation_id);
    setEditData({
      allocated_kick_off: allocation.kick_off?.substring(0, 5),
      camera: allocation.camera || '',
      notes: allocation.notes || '',
    });
  };

  const handleSaveEdit = async (id) => {
    try {
      await updateAllocation(id, editData);
      setEditingId(null);
      showToast('Updated');
      loadGrid();
    } catch (err) {
      showToast('Update failed', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this allocation?')) return;
    try {
      await deleteAllocation(id);
      showToast('Removed');
      loadGrid();
    } catch (err) {
      showToast('Delete failed', 'error');
    }
  };

  const handleRefClaim = async (allocationId, refId) => {
    try {
      await claimMatch(allocationId, refId);
      showToast('Referee assigned');
      loadGrid();
    } catch (err) {
      showToast(err.response?.data?.error || 'Claim failed', 'error');
    }
  };

  const handleRefUnclaim = async (allocationId) => {
    try {
      await unclaimMatch(allocationId);
      showToast('Referee removed');
      loadGrid();
    } catch (err) {
      showToast('Unclaim failed', 'error');
    }
  };

  const weekEnd = format(addDays(new Date(weekDate), 6), 'yyyy-MM-dd');
  const weekLabel = `${format(new Date(weekDate), 'do MMM')} — ${format(new Date(weekEnd), 'do MMM yyyy')}`;

  const totalGames = summary?.venues?.reduce((s, v) => s + parseInt(v.total_games), 0) || 0;
  const refsNeeded = summary?.unrefereed?.length || 0;
  const refsClaimed = totalGames - refsNeeded;

  return (
    <div>
      {/* Week navigation */}
      <div className="week-picker">
        <button onClick={() => setWeekDate(format(subWeeks(new Date(weekDate), 1), 'yyyy-MM-dd'))}>
          ← Prev
        </button>
        <div className="current-week">{weekLabel}</div>
        <button onClick={() => setWeekDate(format(addWeeks(new Date(weekDate), 1), 'yyyy-MM-dd'))}>
          Next →
        </button>
        <button
          onClick={() => setWeekDate(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'))}
          className="btn-today"
        >
          This Week
        </button>
      </div>

      {/* Stats */}
      <div className="stats">
        <div className="stat-card">
          <div className="stat-value">{totalGames}</div>
          <div className="stat-label">Home Games</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: refsClaimed === totalGames && totalGames > 0 ? 'var(--green)' : 'var(--amber)' }}>
            {refsClaimed}/{totalGames}
          </div>
          <div className="stat-label">Refs Assigned</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: refsNeeded > 0 ? 'var(--red)' : 'var(--green)' }}>
            {refsNeeded}
          </div>
          <div className="stat-label">Refs Needed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary?.venues?.length || 0}</div>
          <div className="stat-label">Venues Active</div>
        </div>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="action-bar">
          <button className="btn btn-outline" onClick={handleScrape} disabled={loading}>
            {loading ? '⏳' : '🔄'} Fetch Fixtures
          </button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
            {loading ? '⏳' : '⚡'} Auto-Allocate
          </button>
          <button
            className="btn btn-success"
            onClick={() => setShowPublishConfirm(true)}
            disabled={loading || totalGames === 0}
          >
            📲 Publish to WhatsApp
          </button>
        </div>
      )}

      {/* Conflicts banner */}
      {conflicts.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--amber)', background: 'var(--amber-bg)' }}>
          <h3 style={{ color: 'var(--amber)', fontSize: 14, marginBottom: 8 }}>
            ⚠️ {conflicts.length} Allocation Conflict{conflicts.length > 1 ? 's' : ''}
          </h3>
          {conflicts.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <strong>{cleanTeamName(c.fixture?.home_team)}</strong> — {c.reason}
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Use Manual Import in Admin to add these, or adjust existing allocations.
          </p>
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          <div className="spinner" />
          <p style={{ marginTop: 12 }}>Loading allocations...</p>
        </div>
      )}

      {/* Allocation grid by venue, grouped by day */}
      {grid && !loading && (
        <>
          {Object.keys(grid.grid).length === 0 ? (
            <div className="empty-state">
              <h3>No allocations for this week</h3>
              <p>Fetch fixtures from the FA and run auto-allocate to get started.</p>
            </div>
          ) : (
            Object.entries(grid.grid).map(([venue, pitches]) => (
              <div className="card" key={venue}>
                <div className="card-header">
                  <h2>📍 {venue}</h2>
                </div>

                {Object.entries(pitches).map(([pitch, dates]) => {
                  // Group dates by day of week for visual separation
                  const dateEntries = Object.entries(dates);

                  return (
                    <div key={pitch} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 10, fontWeight: 600 }}>
                        {pitch}
                      </h3>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="grid-table">
                          <thead>
                            <tr>
                              <th>Day</th>
                              <th>KO</th>
                              <th>Match</th>
                              <th>Age</th>
                              <th>Referee</th>
                              <th className="hide-mobile">Camera</th>
                              <th>Status</th>
                              {isAdmin && <th>Actions</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {dateEntries.map(([date, allocations]) => {
                              const dayName = formatMatchDay(date);
                              const dayLabel = `${dayName} ${format(new Date(date + 'T12:00:00'), 'd/M')}`;

                              return allocations.map((a, idx) => (
                                <tr key={a.allocation_id}>
                                  <td style={{ whiteSpace: 'nowrap' }}>
                                    {idx === 0 && (
                                      <span className={`badge ${dayName === 'Saturday' ? 'badge-amber' : 'badge-blue'}`}>
                                        {dayLabel}
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    {editingId === a.allocation_id ? (
                                      <select
                                        value={editData.allocated_kick_off}
                                        onChange={(e) => setEditData({ ...editData, allocated_kick_off: e.target.value })}
                                        style={{ width: 80 }}
                                      >
                                        {['10:00', '11:15', '12:00', '12:30', '14:00'].map((t) => (
                                          <option key={t} value={t}>{t}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <strong>{a.kick_off?.substring(0, 5)}</strong>
                                    )}
                                  </td>
                                  <td>
                                    <div style={{ fontWeight: 500 }}>{cleanTeamName(a.home_team)}</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                      vs {cleanTeamName(a.away_team)}
                                    </div>
                                  </td>
                                  <td>
                                    <span className="badge badge-blue">{a.age_group}</span>
                                    {a.gender === 'girls' && (
                                      <span className="badge badge-amber" style={{ marginLeft: 4 }}>G</span>
                                    )}
                                  </td>
                                  <td>
                                    {a.referee ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span className="badge badge-green">✓ {a.referee}</span>
                                        {isAdmin && (
                                          <button
                                            onClick={() => handleRefUnclaim(a.allocation_id)}
                                            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, padding: 2 }}
                                            title="Remove referee"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </div>
                                    ) : isAdmin ? (
                                      <select
                                        style={{ background: 'var(--red-bg)', border: '1px dashed var(--red)', color: 'var(--red)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                                        defaultValue=""
                                        onChange={(e) => {
                                          if (e.target.value) handleRefClaim(a.allocation_id, e.target.value);
                                        }}
                                      >
                                        <option value="">🔴 Assign ref...</option>
                                        {referees.map((r) => (
                                          <option key={r.id} value={r.id}>{r.name}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className="badge badge-red">🔴 Needed</span>
                                    )}
                                  </td>
                                  <td className="hide-mobile">
                                    {editingId === a.allocation_id ? (
                                      <input
                                        value={editData.camera}
                                        onChange={(e) => setEditData({ ...editData, camera: e.target.value })}
                                        placeholder="Camera"
                                        style={{ width: 80 }}
                                      />
                                    ) : (
                                      a.camera || '—'
                                    )}
                                  </td>
                                  <td>
                                    <span className={`badge ${a.status === 'confirmed' ? 'badge-green' : 'badge-amber'}`}>
                                      {a.status}
                                    </span>
                                  </td>
                                  {isAdmin && (
                                    <td>
                                      {editingId === a.allocation_id ? (
                                        <div style={{ display: 'flex', gap: 4 }}>
                                          <button className="btn btn-sm btn-success" onClick={() => handleSaveEdit(a.allocation_id)}>Save</button>
                                          <button className="btn btn-sm btn-outline" onClick={() => setEditingId(null)}>Cancel</button>
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', gap: 4 }}>
                                          <button className="btn btn-sm btn-outline" onClick={() => handleEdit(a)}>✏️</button>
                                          <button className="btn btn-sm btn-outline" onClick={() => handleDelete(a.allocation_id)} style={{ color: 'var(--red)' }}>🗑</button>
                                        </div>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              ));
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </>
      )}

      {/* Publish confirmation modal */}
      {showPublishConfirm && (
        <div className="modal-overlay" onClick={() => setShowPublishConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>📲 Publish to WhatsApp</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              This will confirm all draft allocations and generate the WhatsApp message.
              You can copy it to the group or it will send automatically if the API is configured.
            </p>
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-input)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              {totalGames} games across {summary?.venues?.length || 0} venues.
              {refsNeeded > 0 && <span style={{ color: 'var(--red)' }}> {refsNeeded} still need a ref.</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setShowPublishConfirm(false)}>Cancel</button>
              <button className="btn btn-success" onClick={handlePublish}>Confirm & Publish</button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp message preview */}
      {waPreview && (
        <div className="card">
          <div className="card-header">
            <h2>📲 WhatsApp Message</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={() => {
                navigator.clipboard.writeText(waPreview);
                showToast('Copied to clipboard!');
              }}>
                📋 Copy
              </button>
              <button className="btn btn-sm btn-outline" onClick={() => setWaPreview(null)}>
                Dismiss
              </button>
            </div>
          </div>
          <div className="wa-preview">{waPreview}</div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
