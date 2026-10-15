import { useEffect, useId, useState } from 'react';
import { CheckCircleIcon, ChevronIcon } from './icons.jsx';

const STORAGE_KEY = 'planner.completedOpen';

function readOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Collapsible list of today's completed tasks. Open/closed is remembered. */
export default function CompletedSection({ count, children }) {
  const [open, setOpen] = useState(readOpen);
  const panelId = useId();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(open));
    } catch {
      /* storage unavailable (private mode) — fine, just not remembered */
    }
  }, [open]);

  if (count === 0) return null;

  return (
    <section className="completed" aria-labelledby={`${panelId}-heading`}>
      <h3 id={`${panelId}-heading`} className="completed-heading">
        <button
          type="button"
          className="collapse-btn"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronIcon className="collapse-chevron" />
          <CheckCircleIcon className="completed-icon" width={16} height={16} />
          Completed
          <span className="badge badge-green">{count}</span>
          <span className="collapse-hint">{open ? 'Hide' : 'Show'}</span>
        </button>
      </h3>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
