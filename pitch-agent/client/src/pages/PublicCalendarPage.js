import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCalendar, getTeams } from '../utils/api';
import { cleanTeamName, parseDate } from '../utils/helpers';

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function fmtShortDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function fmtTime(t) {
  if (!t) return '';
  return String(t).substring(0, 5);
}

export default function PublicCalendarPage() {
  const [searchParams] = useSearchParams();
  const teamParam = searchParams.get('team') || '';
  const weekParam = searchParams.get('week');
  const viewParam = searchParams.get('view');

  const [calendar, setCalendar] = useState(null);
  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState(teamParam);
  const [weekStart, setWeekStart] = useState(() => {
    if (weekParam && parseDate(weekParam)) return weekParam;
    return fmtDate(getMonday(new Date()));
  });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState(viewParam === 'list' ? 'list' : 'calendar');

  useEffect(() => {
    loadData();
  }, [weekStart]);

  useEffect(() => {
    getTeams().then(res => setTeams(res.data)).catch(() => {});
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getCalendar(weekStart, 4);
      setCalendar(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const shiftWeeks = (n) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + n * 7);
    setWeekStart(fmtDate(d));
  };

  const goToThisWeek = () => setWeekStart(fmtDate(getMonday(new Date())));

  // Build display data
  const { fixtures, dates, venueGrids } = useMemo(() => {
    if (!calendar) return { fixtures: [], dates: [], venueGrids: {} };

    const dates = calendar.dates || [];

    const all = [
      ...calendar.allocations.map(a => ({ ...a, allocated: true })),
      ...calendar.unallocated.map(u => ({
        ...u,
        venue_name: null,
        pitch_name: null,
        allocated_kick_off: u.kick_off,
        allocated: false,
        status: 'unallocated',
      })),
    ];

    const filtered = teamFilter
      ? all.filter(a => a.home_team === teamFilter || a.away_team === teamFilter)
      : all;

    // Sort for list view
    const sorted = [...filtered].sort((a, b) =>
      (a.match_date || '').localeCompare(b.match_date || '') ||
      (a.allocated_kick_off || '').localeCompare(b.allocated_kick_off || '')
    );

    // Group by venue → pitch → date for calendar view
    const venueGrids = {};
    for (const item of filtered) {
      if (!item.allocated) {
        const venue = 'Unallocated';
        const pitch = 'Needs Pitch';
        if (!venueGrids[venue]) venueGrids[venue] = {};
        if (!venueGrids[venue][pitch]) venueGrids[venue][pitch] = {};
        if (!venueGrids[venue][pitch][item.match_date]) venueGrids[venue][pitch][item.match_date] = [];
        venueGrids[venue][pitch][item.match_date].push(item);
        continue;
      }
      const venue = item.venue_name || 'Unknown';
      const pitch = `${item.pitch_name} (${item.pitch_format || item.format})`;
      if (!venueGrids[venue]) venueGrids[venue] = {};
      if (!venueGrids[venue][pitch]) venueGrids[venue][pitch] = {};
      if (!venueGrids[venue][pitch][item.match_date]) venueGrids[venue][pitch][item.match_date] = [];
      venueGrids[venue][pitch][item.match_date].push(item);
    }

    return { fixtures: sorted, dates, venueGrids };
  }, [calendar, teamFilter]);

  // Group fixtures by date for list view
  const fixturesByDate = useMemo(() => {
    const grouped = {};
    for (const f of fixtures) {
      if (!grouped[f.match_date]) grouped[f.match_date] = [];
      grouped[f.match_date].push(f);
    }
    return grouped;
  }, [fixtures]);

  const selectedTeamClean = teamFilter ? cleanTeamName(teamFilter) : '';
  const venues = Object.keys(venueGrids).filter(v => v !== 'Unallocated');
  const hasUnallocated = !!venueGrids['Unallocated'];
  const displayVenues = [...venues, ...(hasUnallocated ? ['Unallocated'] : [])];

  return (
    <div className="app" style={{ maxWidth: viewMode === 'calendar' ? 1200 : 700 }}>
      <header style={{ textAlign: 'center', padding: '20px 0', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>
          &#9917; Morley YFC Fixtures
        </h1>
        {selectedTeamClean && (
          <p style={{ color: 'var(--accent)', fontSize: 15, fontWeight: 600, marginTop: 6 }}>
            {selectedTeamClean}
          </p>
        )}
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          4-week schedule &middot; Sat & Sun
        </p>
      </header>

      {/* Team selector + view toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 500 }}>
            Select your team
          </label>
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            style={{ width: '100%', fontSize: 14, padding: '10px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 7 }}
          >
            <option value="">All Teams</option>
            {teams.map(t => (
              <option key={t} value={t}>{cleanTeamName(t)}</option>
            ))}
          </select>
        </div>
        <div className="nav" style={{ flexShrink: 0 }}>
          <button
            className={viewMode === 'calendar' ? 'active' : ''}
            onClick={() => setViewMode('calendar')}
          >
            Calendar
          </button>
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
        </div>
      </div>

      {/* Week nav */}
      <div className="week-picker" style={{ marginBottom: 16, justifyContent: 'center' }}>
        <button onClick={() => shiftWeeks(-4)}>&laquo;</button>
        <button onClick={() => shiftWeeks(-1)}>&lsaquo;</button>
        <span className="current-week" style={{ minWidth: 'auto', fontSize: 13 }}>
          {fmtShortDate(weekStart)} &mdash; {dates.length > 0 ? fmtShortDate(dates[dates.length - 1]) : ''}
        </span>
        <button onClick={() => shiftWeeks(1)}>&rsaquo;</button>
        <button onClick={() => shiftWeeks(4)}>&raquo;</button>
        <button className="btn-today" onClick={goToThisWeek} style={{ fontSize: 11, padding: '4px 10px' }}>Today</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div className="spinner" />
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Loading fixtures...</p>
        </div>
      ) : fixtures.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>&#128197;</div>
          <p>{teamFilter ? `No upcoming fixtures for ${selectedTeamClean}` : 'No fixtures in this period'}</p>
        </div>
      ) : viewMode === 'calendar' ? (
        /* ===== CALENDAR GRID VIEW ===== */
        <>
          <p className="landscape-hint" style={{
            display: 'none',
            fontSize: 12,
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginBottom: 12,
          }}>
            Rotate your phone to landscape for the best view
          </p>

          {displayVenues.map(venue => (
            <div key={venue} className="card" style={{ marginBottom: 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <div className="card-header" style={{ position: 'sticky', left: 0 }}>
                <h2 style={{ color: venue === 'Unallocated' ? 'var(--amber)' : 'var(--text-primary)' }}>
                  {venue}
                </h2>
              </div>

              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="calendar-table">
                  <thead>
                    <tr>
                      <th className="calendar-pitch-col">Pitch</th>
                      {dates.map(d => (
                        <th key={d} className="calendar-date-col">
                          <div>{fmtShortDate(d)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(venueGrids[venue] || {}).map(([pitch, pitchDates]) => (
                      <tr key={pitch}>
                        <td className="calendar-pitch-col">
                          <strong style={{ fontSize: 12 }}>{pitch}</strong>
                        </td>
                        {dates.map(d => {
                          const items = pitchDates[d] || [];
                          return (
                            <td key={d} className="calendar-cell">
                              {items.map((item, i) => (
                                <div key={i} className={`calendar-fixture ${item.status === 'confirmed' ? 'confirmed' : item.status === 'unallocated' ? 'unallocated' : 'draft'}`}>
                                  <div className="calendar-fixture-time">
                                    {fmtTime(item.allocated_kick_off)}
                                  </div>
                                  <div className="calendar-fixture-teams">
                                    {cleanTeamName(item.home_team)}
                                  </div>
                                  <div className="calendar-fixture-vs">
                                    vs {cleanTeamName(item.away_team)}
                                  </div>
                                  <div className="calendar-fixture-meta">
                                    <span className={`badge ${item.gender === 'girls' ? 'badge-amber' : 'badge-blue'}`} style={{ fontSize: 9, padding: '1px 5px' }}>
                                      {item.age_group}
                                    </span>
                                    {item.referee_name && (
                                      <span style={{ fontSize: 9, color: 'var(--green)' }}>{item.referee_name}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {Object.keys(venueGrids[venue] || {}).length === 0 && (
                      <tr>
                        <td colSpan={dates.length + 1} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                          No fixtures at this venue
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      ) : (
        /* ===== LIST VIEW ===== */
        Object.entries(fixturesByDate).map(([date, dayFixtures]) => (
          <div key={date} className="card" style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--accent)',
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom: '1px solid var(--border)',
            }}>
              {fmtShortDate(date)}
            </div>

            {dayFixtures.map((f, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 0',
                  borderBottom: i < dayFixtures.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                    {fmtTime(f.allocated_kick_off)}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <span className={`badge ${f.gender === 'girls' ? 'badge-amber' : 'badge-blue'}`} style={{ fontSize: 10 }}>
                      {f.age_group}
                    </span>
                    <span className={`badge ${f.status === 'confirmed' ? 'badge-green' : f.status === 'unallocated' ? 'badge-red' : 'badge-blue'}`} style={{ fontSize: 10 }}>
                      {f.status === 'confirmed' ? 'Confirmed' : f.status === 'unallocated' ? 'TBC' : 'Draft'}
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                  {cleanTeamName(f.home_team)} <span style={{ color: 'var(--text-muted)' }}>vs</span> {cleanTeamName(f.away_team)}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {f.venue_name && f.pitch_name && (
                    <span>&#128205; {f.venue_name} &middot; {f.pitch_name}</span>
                  )}
                  {!f.venue_name && (
                    <span style={{ color: 'var(--amber)' }}>Pitch TBC</span>
                  )}
                  {f.referee_name && (
                    <span style={{ color: 'var(--green)' }}>&#127937; {f.referee_name}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <a href="/request" style={{ color: 'var(--accent)', fontSize: 13 }}>
          Need to request a friendly or pitch change? &rarr;
        </a>
      </div>
    </div>
  );
}
