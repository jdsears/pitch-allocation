import React, { useState, useEffect, useCallback } from 'react';
import { format, startOfWeek, addDays } from 'date-fns';
import { getAllocationOverview, getOverviewMessage, generateAllocations } from '../utils/api';
import { cleanTeamName, formatMatchDay, parseDate } from '../utils/helpers';

export default function OverviewGrid() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [waPreview, setWaPreview] = useState(null);
  const [waLoading, setWaLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const thisMonday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAllocationOverview(thisMonday, 4);
      setOverview(res.data);
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
    setLoading(false);
  }, [thisMonday]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const handleFetchFixtures = async () => {
    await loadOverview();
    showToast('Fixtures refreshed');
  };

  const handleAutoAllocate = async () => {
    setLoading(true);
    try {
      let totalAllocated = 0;
      let totalConflicts = 0;
      // Auto-allocate each of the 4 weeks
      for (let w = 0; w < 4; w++) {
        const weekStart = format(addDays(new Date(thisMonday), w * 7), 'yyyy-MM-dd');
        const res = await generateAllocations(weekStart);
        totalAllocated += res.data.allocated || 0;
        totalConflicts += (res.data.conflicts || []).length;
      }
      showToast(`Allocated ${totalAllocated} fixtures${totalConflicts ? ` (${totalConflicts} conflicts)` : ''}`);
      await loadOverview();
    } catch (err) {
      showToast('Allocation failed', 'error');
    }
    setLoading(false);
  };

  const handleGenerateMessage = async () => {
    setWaLoading(true);
    try {
      const res = await getOverviewMessage(thisMonday, 4);
      setWaPreview(res.data.message);
    } catch (err) {
      console.error('Failed to generate message:', err);
      showToast('Failed to generate message', 'error');
    }
    setWaLoading(false);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
        <div className="spinner" />
        <p style={{ marginTop: 12 }}>Loading 4-week overview...</p>
      </div>
    );
  }

  if (!overview) return null;

  // Aggregate stats
  const totals = overview.weeks.reduce(
    (acc, w) => ({
      games: acc.games + w.totalGames,
      refs: acc.refs + w.refsAssigned,
      needed: acc.needed + w.refsNeeded,
      unallocated: acc.unallocated + w.unallocated,
    }),
    { games: 0, refs: 0, needed: 0, unallocated: 0 }
  );

  return (
    <div>
      {/* Stats */}
      <div className="stats">
        <div className="stat-card">
          <div className="stat-value">{totals.games}</div>
          <div className="stat-label">Total Games (4 Weeks)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: totals.refs === totals.games && totals.games > 0 ? 'var(--green)' : 'var(--amber)' }}>
            {totals.refs}/{totals.games}
          </div>
          <div className="stat-label">Refs Assigned</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: totals.needed > 0 ? 'var(--red)' : 'var(--green)' }}>
            {totals.needed}
          </div>
          <div className="stat-label">Refs Needed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: totals.unallocated > 0 ? 'var(--amber)' : 'var(--green)' }}>
            {totals.unallocated}
          </div>
          <div className="stat-label">Unallocated</div>
        </div>
      </div>

      {/* Action bar */}
      <div className="action-bar">
        <button className="btn btn-outline" onClick={handleFetchFixtures} disabled={loading}>
          {loading ? '⏳' : '🔄'} Fetch Fixtures
        </button>
        <button className="btn btn-primary" onClick={handleAutoAllocate} disabled={loading}>
          {loading ? '⏳' : '⚡'} Auto-Allocate All
        </button>
        <button
          className="btn btn-success"
          onClick={handleGenerateMessage}
          disabled={waLoading || totals.games === 0}
        >
          {waLoading ? '⏳' : '📲'} Generate WhatsApp Overview
        </button>
      </div>

      {waPreview && (
        <div className="card">
          <div className="card-header">
            <h2>📲 WhatsApp Overview Message</h2>
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

      {/* Per-week sections */}
      {overview.weeks.map((week) => {
        const wsDate = parseDate(week.weekStart);
        const weDate = parseDate(week.weekEnd);
        const weekLabel = wsDate && weDate
          ? `${format(wsDate, 'do MMM')} \u2014 ${format(weDate, 'do MMM yyyy')}`
          : `${week.weekStart} \u2014 ${week.weekEnd}`;

        const isEmpty = week.totalGames === 0 && week.unallocated === 0;

        return (
          <div className="card overview-week" key={week.weekStart}>
            <div className="card-header">
              <h2>{weekLabel}</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {week.totalGames > 0 && (
                  <span className="badge badge-blue">{week.totalGames} game{week.totalGames !== 1 ? 's' : ''}</span>
                )}
                {week.refsNeeded > 0 && (
                  <span className="badge badge-red">{week.refsNeeded} ref{week.refsNeeded !== 1 ? 's' : ''} needed</span>
                )}
                {week.unallocated > 0 && (
                  <span className="badge badge-amber">{week.unallocated} unallocated</span>
                )}
              </div>
            </div>

            {isEmpty ? (
              <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                No fixtures this week
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>KO</th>
                      <th>Venue</th>
                      <th>Match</th>
                      <th>Age</th>
                      <th>Referee</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {week.allocations.map((a, i) => {
                      const matchDate = parseDate(a.match_date);
                      const dayName = matchDate ? formatMatchDay(a.match_date) : 'TBC';
                      const dayLabel = matchDate ? `${dayName} ${format(matchDate, 'd/M')}` : 'TBC';

                      // Show day badge only on first row of each date
                      const prevDate = i > 0 ? week.allocations[i - 1].match_date : null;
                      const isNewDate = a.match_date !== prevDate;

                      return (
                        <tr key={a.allocation_id}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {isNewDate && (
                              <span className={`badge ${dayName === 'Saturday' ? 'badge-amber' : 'badge-blue'}`}>
                                {dayLabel}
                              </span>
                            )}
                          </td>
                          <td><strong>{a.kick_off?.substring(0, 5)}</strong></td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {a.venue_name}
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.pitch_name}</div>
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
                              <span className="badge badge-green">{a.referee}</span>
                            ) : (
                              <span className="badge badge-red">Needed</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${a.status === 'confirmed' ? 'badge-green' : 'badge-amber'}`}>
                              {a.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
