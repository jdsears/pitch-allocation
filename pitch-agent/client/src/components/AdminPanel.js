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
} from '../utils/api';

export default function AdminPanel() {
  const [referees, setReferees] = useState([]);
  const [venues, setVenues] = useState([]);
  const [requests, setRequests] = useState([]);
  const [newRef, setNewRef] = useState({ name: '', phone: '' });
  const [importText, setImportText] = useState('');
  const [toast, setToast] = useState(null);
  const [activeSection, setActiveSection] = useState('referees');
  const [ocrFile, setOcrFile] = useState(null);
  const [ocrGender, setOcrGender] = useState('boys');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrPreview, setOcrPreview] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [refsRes, venuesRes, reqRes] = await Promise.all([
        getReferees(),
        getVenues(),
        getRequests('pending'),
      ]);
      setReferees(refsRes.data);
      setVenues(venuesRes.data);
      setRequests(reqRes.data);
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
        const gender = parts[5] || 'boys';
        const boysFormatMap = { U6: '5v5', U7: '5v5', U8: '5v5', U9: '7v7', U10: '7v7', U11: '9v9', U12: '9v9', U13: '11v11', U14: '11v11', U15: '11v11', U16: '11v11', U17: '11v11', U18: '11v11' };
        // Girls play 9v9 at U13 and U14 (NWGFL rules) — 11v11 from U15
        const girlsFormatMap = { ...boysFormatMap, U13: '9v9', U14: '9v9' };
        const formatMap = gender === 'girls' ? girlsFormatMap : boysFormatMap;
        return {
          match_date: parts[0],
          kick_off: parts[1] || null,
          home_team: parts[2],
          away_team: parts[3],
          age_group: ageGroup,
          gender,
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

  const handleRequestAction = async (id, status) => {
    try {
      await updateRequest(id, { status });
      showToast(`Request ${status}`);
      loadData();
    } catch (err) {
      showToast('Update failed', 'error');
    }
  };

  return (
    <div>
      {/* Section tabs */}
      <div className="nav" style={{ marginBottom: 20 }}>
        {['referees', 'scrape', 'import', 'venues', 'requests'].map(s => (
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

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                type="file"
                accept="image/*"
                onChange={handleOcrFileChange}
                style={{ fontSize: 13 }}
              />
              <select
                value={ocrGender}
                onChange={e => setOcrGender(e.target.value)}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <option value="boys">Boys</option>
                <option value="girls">Girls</option>
              </select>
              <button
                className="btn btn-primary"
                onClick={handleOcrImport}
                disabled={!ocrFile || ocrLoading}
              >
                {ocrLoading ? 'Extracting...' : 'Extract & Import'}
              </button>
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
              <div style={{ background: '#fee', color: '#c00', padding: 12, borderRadius: 8, fontSize: 13 }}>
                {ocrResult.error}
              </div>
            )}

            {ocrResult && ocrResult.fixtures && ocrResult.fixtures.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Found {ocrResult.fixtures.length} fixtures, {ocrResult.saved} saved to database:
                </p>
                <table className="grid-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>KO</th>
                      <th>Home</th>
                      <th>Away</th>
                      <th>Age</th>
                      <th>H/A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocrResult.fixtures.map((f, i) => (
                      <tr key={i}>
                        <td>{f.match_date}</td>
                        <td>{f.kick_off || '—'}</td>
                        <td>{f.home_team}</td>
                        <td>{f.away_team}</td>
                        <td>{f.age_group || '—'}</td>
                        <td>{f.is_home_game ? 'H' : 'A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* CSV Import */}
          <div className="card">
            <div className="card-header">
              <h2>Import from Text</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
              Paste fixtures manually, one per line:
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
                          Approve
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
