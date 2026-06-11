import React, { useState } from 'react';

const STORAGE_KEY = 'morley-theme';

/** Light/dark toggle. Persists choice and applies it to <html data-theme>. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light'
  );

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* private mode */ }
    setTheme(next);
  };

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      aria-label="Toggle light or dark theme"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
