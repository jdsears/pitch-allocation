import React, { useState } from 'react';
import { submitRequest } from '../utils/api';

export default function RequestForm() {
  const [form, setForm] = useState({
    requested_by: '',
    request_type: 'friendly',
    details: '',
    match_date: '',
    kick_off: '',
    pitch_format: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await submitRequest(form);
      setSubmitted(true);
    } catch (err) {
      setError('Failed to submit. Please try again.');
    }
  };

  if (submitted) {
    return (
      <div className="app" style={{ maxWidth: 500 }}>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Request Submitted</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Guy will review this and get back to you.
          </p>
          <a href="/grid" style={{ color: 'var(--accent)', fontSize: 13, marginTop: 16, display: 'block' }}>
            ← Back to allocations
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="app" style={{ maxWidth: 500 }}>
      <header style={{ textAlign: 'center', padding: '20px 0', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20 }}>⚽ Pitch Request</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Friendlies, changes, or ad-hoc bookings</p>
      </header>

      <form onSubmit={handleSubmit} className="card">
        <div className="form-group">
          <label>Your Name / Team</label>
          <input
            value={form.requested_by}
            onChange={e => setForm({ ...form, requested_by: e.target.value })}
            placeholder="e.g. Dave - U10 Hawks"
            required
            style={{ width: '100%' }}
          />
        </div>

        <div className="form-group">
          <label>Request Type</label>
          <select
            value={form.request_type}
            onChange={e => setForm({ ...form, request_type: e.target.value })}
            style={{ width: '100%' }}
          >
            <option value="friendly">Friendly Match</option>
            <option value="change">Change Existing Allocation</option>
            <option value="cancel">Cancel / Postponement</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="form-group">
          <label>Date Needed</label>
          <input
            type="date"
            value={form.match_date}
            onChange={e => setForm({ ...form, match_date: e.target.value })}
            style={{ width: '100%' }}
          />
        </div>

        <div className="form-group">
          <label>Preferred Kick-off</label>
          <select
            value={form.kick_off}
            onChange={e => setForm({ ...form, kick_off: e.target.value })}
            style={{ width: '100%' }}
          >
            <option value="">No preference</option>
            <option value="10:00">10:00</option>
            <option value="11:15">11:15</option>
            <option value="12:00">12:00</option>
            <option value="12:30">12:30</option>
            <option value="14:00">14:00</option>
          </select>
        </div>

        <div className="form-group">
          <label>Pitch Format</label>
          <select
            value={form.pitch_format}
            onChange={e => setForm({ ...form, pitch_format: e.target.value })}
            style={{ width: '100%' }}
          >
            <option value="">Any / Not sure</option>
            <option value="5v5">5v5</option>
            <option value="7v7">7v7</option>
            <option value="9v9">9v9</option>
            <option value="11v11">11v11</option>
          </select>
        </div>

        <div className="form-group">
          <label>Details</label>
          <textarea
            value={form.details}
            onChange={e => setForm({ ...form, details: e.target.value })}
            placeholder="e.g. Friendly vs Hethersett, need 9v9 pitch at Morley on Saturday morning"
            rows={3}
            required
            style={{
              width: '100%',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: 12,
              borderRadius: 8,
              fontSize: 13,
              resize: 'vertical',
            }}
          />
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
          Submit Request
        </button>
      </form>
    </div>
  );
}
