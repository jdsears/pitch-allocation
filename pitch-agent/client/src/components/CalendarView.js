import React, { useState, useEffect, useMemo } from 'react';
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

export default function CalendarView() {
  const [calendar, setCalendar] = useState(null);
  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [weekStart, setWeekStart] = useState(() => fmtDate(getMonday(new Date())));
  const [loading, setLoading] = useState(true);
  const [venueFilter, setVenueFilter] = useState('all');

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

  // Build the calendar grid data
  const { venueGrids, dates } = useMemo(() => {
    if (!calendar) return { venueGrids: {}, dates: [] };

    const dates = calendar.dates || [];

    // Combine allocated + unallocated into one list
    const all = [
      ...calendar.allocations.map(a => ({
        ...a,
        allocated: true,
      })),
      ...calendar.unallocated.map(u => ({
        ...u,
        venue_name: null,
        pitch_name: null,
        allocated_kick_off: u.kick_off,
        allocated: false,
        status: 'unallocated',
      })),
    ];

    // Apply team filter
    const filtered = teamFilter
      ? all.filter(a =>
          a.home_team === teamFilter || a.away_team === teamFilter
        )
      : all;

    // Group by venue → pitch → date
    const venueGrids = {};

    for (const item of filtered) {
      if (!item.allocated) {
        // Unallocated go into a special bucket
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

    return { venueGrids, dates };
  }, [calendar, teamFilter]);

  const venues = Object.keys(venueGrids).filter(v => v !== 'Unallocated');
  const hasUnallocated = !!venueGrids['Unallocated'];
  const displayVenues = venueFilter === 'all'
    ? [...venues, ...(hasUnallocated ? ['Unallocated'] : [])]
    : venueFilter === 'unallocated'
      ? (hasUnallocated ? ['Unallocated'] : [])
      : [venueFilter, ...(hasUnallocated ? ['Unallocated'] : [])];

  return (
    <div>
      {/* Controls bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div className="week-picker" style={{ marginBottom: 0, flex: '1 1 auto' }}>
          <button onClick={() => shiftWeeks(-4)}>&laquo;</button>
          <button onClick={() => shiftWeeks(-1)}>&lsaquo;</button>
          <span className="current-week" style={{ minWidth: 'auto', fontSize: 14 }}>
            {fmtShortDate(weekStart)} — {dates.length > 0 ? fmtShortDate(dates[dates.length - 1]) : ''}
          </span>
          <button onClick={() => shiftWeeks(1)}>&rsaquo;</button>
          <button onClick={() => shiftWeeks(4)}>&raquo;</button>
          <button className="btn-today" onClick={goToThisWeek} style={{ fontSize: 11, padding: '4px 10px' }}>Today</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Filter by Team</label>
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            style={{ width: '100%', fontSize: 13, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 7 }}
          >
            <option value="">All Teams</option>
            {teams.map(t => (
              <option key={t} value={t}>{cleanTeamName(t)}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '0 1 140px' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Venue</label>
          <select
            value={venueFilter}
            onChange={e => setVenueFilter(e.target.value)}
            style={{ width: '100%', fontSize: 13, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 7 }}
          >
            <option value="all">All Venues</option>
            {venues.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : (
        <>
          {/* Landscape hint on mobile */}
          <p className="landscape-hint" style={{
            display: 'none',
            fontSize: 12,
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginBottom: 12,
          }}>
            Rotate your phone to landscape for the best view
          </p>

          {displayVenues.length === 0 && (
            <div className="empty-state">
              <p>{teamFilter ? `No fixtures found for ${cleanTeamName(teamFilter)}` : 'No fixtures in this period'}</p>
            </div>
          )}

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
      )}
    </div>
  );
}
