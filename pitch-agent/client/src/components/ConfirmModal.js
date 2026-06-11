import React from 'react';

/**
 * In-app confirmation modal for destructive actions — replaces
 * window.confirm, which is easy to mis-tap and dismiss on mobile.
 *
 * Render conditionally: {confirm && <ConfirmModal ... />}
 */
export default function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel, danger = true }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '12px 0 20px' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            style={danger ? { background: 'var(--red)', color: '#fff' } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
