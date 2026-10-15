// Small presentational pieces for loading, empty, error and notice states.
// Every status carries an icon and words, not just a color.
import { useEffect } from 'react';
import { AlertIcon, CheckCircleIcon, CloseIcon } from './icons.jsx';

export function EmptyState({ icon, title, hint, action, compact = false, tone }) {
  return (
    <div className={`empty${compact ? ' empty-compact' : ''}${tone ? ` empty-${tone}` : ''}`}>
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div>
        <p className="empty-title">{title}</p>
        {hint && <p className="empty-hint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="visually-hidden">Loading your tasks…</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <span className="skeleton skeleton-check" />
          <span className="skeleton skeleton-line" style={{ width: `${70 - i * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

export function LoadError({ error, onRetry }) {
  return (
    <div className="load-error" role="alert">
      <AlertIcon className="load-error-icon" width={24} height={24} />
      <p className="empty-title">Couldn’t load your planner.</p>
      <p className="empty-hint">
        {error?.message || 'The server didn’t respond.'} Make sure the API is running on port 3001.
      </p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/**
 * Success messages appear as a toast and are announced politely; errors stay
 * on screen as an alert until dismissed.
 */
export function Notice({ notice, onDismiss }) {
  useEffect(() => {
    if (notice?.type !== 'success') return undefined;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [notice, onDismiss]);

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite">
        {notice?.type === 'success' ? notice.message : ''}
      </div>
      {notice?.type === 'success' && (
        <div className="toast" key={notice.id} aria-hidden="true">
          <CheckCircleIcon className="toast-icon" width={18} height={18} />
          <span className="toast-text">{notice.message}</span>
        </div>
      )}
      {notice?.type === 'error' && (
        <div className="banner banner-error" role="alert">
          <AlertIcon className="banner-icon" width={18} height={18} />
          <p>{notice.message}</p>
          <button type="button" className="btn btn-quiet btn-xs" onClick={onDismiss} aria-label="Dismiss error">
            <CloseIcon width={15} height={15} />
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
