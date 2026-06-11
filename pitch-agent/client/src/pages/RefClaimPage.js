import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, startOfWeek, addDays } from 'date-fns';
import { getAllocationGrid, getReferees, claimMatch, unclaimMatch } from '../utils/api';
import { cleanTeamName, formatMatchDay, parseDate } from '../utils/helpers';

export default function RefClaimPage() {
  const [searchParams] = useSearchParams();
  const weekParam = searchParams.get('week');
  const validWeekParam = weekParam && parseDate(weekParam) ? weekParam : null;
  const [weekDate] = useState(
    validWeekParam || format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [grid, setGrid] = useState(null);
  const [referees, setReferees] = useState([]);
  const [selectedRef, setSelectedRef] = useState('');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadGrid = useCallback(async () => {
    setLoading(true);
    try {
      const [gridRes, refsRes] = await Promise.all([
        getAllocationGrid(weekDate),
        getReferees(),
      ]);
      setGrid(gridRes.data);
      setReferees(refsRes.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [weekDate]);

  useEffect(() => { loadGrid(); }, [loadGrid]);

  const handleClaim = async (allocationId) => {
    if (!selectedRef) {
      showToast('Select your name first', 'error');
      return;
    }
    try {
      await claimMatch(allocationId, selectedRef);
      showToast('Match claimed! Thanks 👍');
      loadGrid();
    } catch (err) {
      showToast(err.response?.data?.error || 'Already claimed', 'error');
    }
  };

  const handleUnclaim = async (allocationId) => {
    try {
      await unclaimMatch(allocationId);
      showToast('Match unclaimed');
      loadGrid();
    } catch (err) {
      showToast('Unclaim failed', 'error');
    }
  };

  const weekEnd = format(addDays(new Date(weekDate), 6), 'yyyy-MM-dd');
  const weekLabel = `${format(new Date(weekDate), 'do MMM')} — ${format(new Date(weekEnd), 'do MMM yyyy')}`;

  // Count unclaimed
  let unclaimedCount = 0;
  if (grid?.grid) {
    Object.values(grid.grid).forEach(pitches => {
      Object.values(pitches).forEach(dates => {
        Object.values(dates).forEach(allocs => {
          allocs.forEach(a => { if (!a.referee) unclaimedCount++; });
        });
      });
    });
  }

  return (
    <div className="app" style={{ maxWidth: 800 }}>
      <header style={{ textAlign: 'center', padding: '20px 0', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>⚽ Morley YFC Pitch Allocations</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{weekLabel}</p>
        {unclaimedCount > 0 && (
          <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 6, fontWeight: 600 }}>
            🔴 {unclaimedCount} match{unclaimedCount > 1 ? 'es' : ''} still need a ref
          </p>
        )}
      </header>

      {/* Ref selector - sticky on mobile. Stacked label + full-width select
          so it stays readable and easy to tap on a phone at the touchline. */}
      <div className="card" style={{ marginBottom: 16, position: 'sticky', top: 0, zIndex: 10 }}>
        <label
          htmlFor="ref-select"
          style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}
        >
          🏁 I am:
        </label>
        <select
          id="ref-select"
          value={selectedRef}
          onChange={(e) => setSelectedRef(e.target.value)}
          style={{ width: '100%', minHeight: 44, fontSize: 15 }}
        >
          <option value="">Select your name to claim matches...</option>
          {referees.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          <div className="spinner" />
          <p style={{ marginTop: 12 }}>Loading allocations...</p>
        </div>
      )}

      {grid?.grid && !loading && (
        <>
          {Object.keys(grid.grid).length === 0 ? (
            <div className="empty-state">
              <h3>No allocations yet for this week</h3>
              <p>Check back later — allocations are usually published mid-week.</p>
            </div>
          ) : (
            Object.entries(grid.grid).map(([venue, pitches]) => (
              <div className="card" key={venue}>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>📍 {venue}</h2>

                {Object.entries(pitches).map(([pitch, dates]) => (
                  <div key={pitch} style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8, fontWeight: 600 }}>{pitch}</h3>
                    
                    {Object.entries(dates).map(([date, allocations]) => {
                      const dayName = formatMatchDay(date);
                      const parsed = parseDate(date);
                      const dayLabel = parsed ? `${dayName} ${format(parsed, 'd MMM')}` : date;
                      return (
                        <div key={date}>
                          {/* Day header */}
                          <div style={{
                            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                            textTransform: 'uppercase', letterSpacing: 0.5,
                            padding: '8px 0 4px', marginTop: 4
                          }}>
                            {dayLabel}
                          </div>

                          {allocations.map(a => (
                            <div
                              key={a.allocation_id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 12px',
                                background: a.referee ? 'var(--bg-card)' : 'var(--red-bg)',
                                border: a.referee ? '1px solid var(--border)' : '1px dashed var(--red)',
                                borderRadius: 8,
                                marginBottom: 6,
                                flexWrap: 'wrap',
                                gap: 8,
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>
                                  {a.kick_off?.substring(0, 5)} — {cleanTeamName(a.home_team)} vs {cleanTeamName(a.away_team)}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  {a.age_group} {a.gender === 'girls' ? '(Girls)' : ''} • {a.format}
                                </div>
                              </div>

                              <div>
                                {a.referee ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span className="badge badge-green">✓ {a.referee}</span>
                                    {selectedRef && String(selectedRef) === String(a.referee_id) && (
                                      <button
                                        className="btn btn-sm btn-outline"
                                        onClick={() => handleUnclaim(a.allocation_id)}
                                        style={{ fontSize: 11 }}
                                      >
                                        Unclaim
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    className="claim-btn"
                                    onClick={() => handleClaim(a.allocation_id)}
                                    disabled={!selectedRef}
                                    style={{ opacity: selectedRef ? 1 : 0.5 }}
                                  >
                                    🏁 Claim Match
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </>
      )}

      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <a href="/request" style={{ color: 'var(--accent)', fontSize: 13 }}>
          Need to request a friendly or pitch change? →
        </a>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
