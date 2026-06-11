import React, { useState, useEffect } from 'react';
import { scrapeFixtures, getScrapeStatus } from '../../utils/api';

/**
 * Admin ▸ Scrape: daily-sync status, manual scrape, and the downloadable
 * local-scrape scripts (the fallback when FA blocks the cloud host).
 * Polls status while mounted so runs show progress live.
 */
export default function ScrapeSection({ showToast }) {
  const [scrapeStatus, setScrapeStatus] = useState(null);
  const [scraping, setScraping] = useState(false);

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

  useEffect(() => {
    loadScrapeStatus();
    const t = setInterval(loadScrapeStatus, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
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
                A timeout usually means FA Full-Time is blocking the cloud server's IP. Set a
                <code style={{ background: 'var(--bg-primary)', padding: '1px 5px', borderRadius: 4, margin: '0 4px' }}>SCRAPE_PROXY</code>
                (UK/residential proxy — see README) to fix the automatic scrape, or use the
                downloadable script below in the meantime.
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
    </>
  );
}
