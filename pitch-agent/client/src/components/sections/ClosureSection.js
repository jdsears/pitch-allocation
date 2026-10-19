import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { getClosure, saveClosure, previewClosure } from '../../utils/api';
import ConfirmModal from '../ConfirmModal';

const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const dayLabel = (s, pattern = 'EEE d MMM') => (parseDay(s) ? format(parseDay(s), pattern) : s);
const todayIso = () => format(new Date(), 'yyyy-MM-dd');

const toForm = (c) => ({
  from: c.from || '',
  to: c.to || '',
  saturday: (c.saturday || []).join(', '),
  sunday: (c.sunday || []).join(', '),
  junior_goals: c.junior_goals || 'first',
});

const labelStyle = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'block' };

/**
 * Admin ▸ Venues: the Shropham closure switch. While on (from the start date,
 * until the optional end date) Auto-Allocate puts every home game at Morley.
 */
export default function ClosureSection({ showToast }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = async () => {
    try {
      const res = await getClosure();
      setSaved(res.data);
      setForm(toForm(res.data));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { load(); }, []);

  if (!saved || !form) return null;

  const payload = (enabled) => ({ ...form, to: form.to || null, enabled });
  const errorOf = (err) => err.response?.data?.error || err.message || 'Something went wrong';

  const save = async (enabled) => {
    setBusy(true);
    try {
      const res = await saveClosure(payload(enabled));
      setSaved(res.data);
      setForm(toForm(res.data));
      showToast(enabled ? 'Shropham closure plan is on' : 'Shropham closure plan switched off');
    } catch (err) {
      showToast(errorOf(err), 'error');
    }
    setBusy(false);
    setConfirmOff(false);
  };

  const runPreview = async () => {
    setBusy(true);
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await previewClosure(payload(true));
      setPreview(res.data);
    } catch (err) {
      showToast(errorOf(err), 'error');
    }
    setBusy(false);
    setPreviewing(false);
  };

  const on = saved.enabled;
  const started = on && saved.from <= todayIso();
  const range = `${dayLabel(saved.from, 'EEE d MMM')}${saved.to ? ` to ${dayLabel(saved.to, 'EEE d MMM')}` : ', until switched off'}`;
  const status = !on
    ? <span className="badge" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>Off</span>
    : started
      ? <span className="badge badge-amber">On — {range}</span>
      : <span className="badge badge-blue">Scheduled — {range}</span>;

  const totalConflicts = preview ? preview.days.reduce((n, d) => n + d.conflicts.length, 0) : 0;

  return (
    <div className="card" style={{ border: on ? '1px solid var(--amber)' : undefined }}>
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2>🚧 Shropham closure — all games at Morley</h2>
        {status}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
        From the start date, Auto-Allocate puts every home game at Morley: U14 play on the 11v11
        with the junior goals (one 11v11 game at a time), 9v9 uses a pitch marked over the 11v11 on
        Saturdays and over the 7v7 on Sundays, and games are spread across the kick-offs below to
        ease parking. Normal rules return after the end date.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Start date</label>
          <input type="date" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>End date (optional)</label>
          <input type="date" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>Saturday kick-offs (09:30–12:30)</label>
          <input value={form.saturday} onChange={e => setForm({ ...form, saturday: e.target.value })} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>Sunday kick-offs (09:30–14:30)</label>
          <input value={form.sunday} onChange={e => setForm({ ...form, sunday: e.target.value })} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>U14 junior-goal games</label>
          <select value={form.junior_goals} onChange={e => setForm({ ...form, junior_goals: e.target.value })} style={{ width: '100%' }}>
            <option value="first">First of the day</option>
            <option value="last">Last of the day</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={runPreview} disabled={busy}>
          {previewing ? '⏳ Running practice allocation…' : '🔍 Preview'}
        </button>
        {on ? (
          <>
            <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>Save changes</button>
            <button className="btn btn-outline" onClick={() => setConfirmOff(true)} disabled={busy} style={{ color: 'var(--red)' }}>
              Switch off
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => save(true)} disabled={busy || !form.from}>
            Switch on from {form.from ? dayLabel(form.from) : '…'}
          </button>
        )}
      </div>

      {on && (
        <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--bg-input)', borderRadius: 8, fontSize: 13 }}>
          <strong>Next:</strong> open each week from {dayLabel(saved.from)} on the Weekly tab and press
          Auto-Allocate. Games still at Shropham (or at the old Morley times) move into the plan, and referees
          who claimed them stay on them. Then re-publish so teams see the new times.
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>
            Practice run, nothing saved: {dayLabel(preview.from)} to {dayLabel(preview.through)}
            {!preview.to && ' (first 8 weeks)'} using the fixtures loaded so far.{' '}
            {totalConflicts === 0
              ? <strong style={{ color: 'var(--green)' }}>Everything fits.</strong>
              : <strong style={{ color: 'var(--red)' }}>{totalConflicts} game{totalConflicts > 1 ? 's' : ''} won't fit.</strong>}
          </div>
          {preview.days.length === 0 && (
            <div className="empty-state"><p>No home fixtures loaded for those dates yet.</p></div>
          )}
          {preview.days.map(d => (
            <details key={d.date} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                <strong>{dayLabel(d.date, 'EEE d MMM')}</strong>
                {' — '}{d.games.length} game{d.games.length !== 1 ? 's' : ''}
                {Object.keys(d.kickOffs).length > 0 && ' · '}
                {Object.entries(d.kickOffs).sort().map(([ko, n]) => `${ko} ×${n}`).join(' · ')}
                {d.conflicts.length > 0 && (
                  <span className="badge badge-red" style={{ marginLeft: 6 }}>{d.conflicts.length} won't fit</span>
                )}
                {d.stillAtShropham > 0 && (
                  <span className="badge badge-amber" style={{ marginLeft: 6 }}>{d.stillAtShropham} still at Shropham</span>
                )}
              </summary>
              <div style={{ fontSize: 12, padding: '6px 0 0 14px' }}>
                {d.conflicts.map((c, i) => (
                  <div key={`c${i}`} style={{ color: 'var(--red)', marginBottom: 2 }}>
                    ⚠️ {c.home_team} v {c.away_team} ({c.age_group}, {c.format}) — {c.reason}
                  </div>
                ))}
                {d.games.map((g, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>
                    <strong>{g.kick_off}</strong> · {g.pitch} · {g.home_team} v {g.away_team} ({g.age_group})
                    {g.junior_goals && <span className="badge badge-amber" style={{ marginLeft: 6 }}>🥅 junior goals</span>}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {confirmOff && (
        <ConfirmModal
          title="Switch off the Shropham closure plan?"
          message="Auto-Allocate goes back to the normal two-venue rules. Draft games are re-placed next time you run Auto-Allocate for their week; confirmed games stay where they are until you move them."
          confirmLabel="Switch off"
          onConfirm={() => save(false)}
          onCancel={() => setConfirmOff(false)}
        />
      )}
    </div>
  );
}
