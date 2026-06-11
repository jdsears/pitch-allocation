import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Apply saved theme before first paint to avoid a flash (default: light)
const savedTheme = (() => {
  try { return localStorage.getItem('morley-theme'); } catch (e) { return null; }
})();
document.documentElement.setAttribute('data-theme', savedTheme || 'light');

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
