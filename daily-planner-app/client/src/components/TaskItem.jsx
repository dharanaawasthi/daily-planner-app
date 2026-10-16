import { useEffect, useState } from 'react';
import { categoryStyle } from '../lib/categories.js';
import { formatTime } from '../lib/dates.js';

export function TimeRange({ task }) {
  if (!task.startTime) return <span className="time-anytime">Anytime</span>;
  return (
    <>
      <time className="time-start">{formatTime(task.startTime)}</time>
      {task.endTime && <time className="time-end">– {formatTime(task.endTime)}</time>}
    </>
  );
}

/**
 * One row in Today or Completed: checkbox, then one button with time, title
 * and category dot. The button opens the task sheet (details, Edit, Delete).
 * Completed rows are marked by a checked box with a check icon and a
 * strikethrough title — never by color alone.
 */
export default function TaskItem({ task, busy, onToggle, onOpen }) {
  const done = task.status === 'completed';
  const titleId = `task-${task.id}-title`;
  const cat = categoryStyle(task.category);

  // Show the click immediately while the request runs. When it finishes the
  // row re-renders from server data (and moves list), or reverts on failure.
  const [optimisticDone, setOptimisticDone] = useState(null);
  useEffect(() => {
    if (!busy) setOptimisticDone(null);
  }, [busy]);
  const checked = optimisticDone ?? done;

  return (
    <li
      className={`task${done ? ' is-done' : ''}${busy ? ' is-busy' : ''}`}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
    >
      <label className="check-hit">
        <input
          type="checkbox"
          className="check"
          checked={checked}
          disabled={busy}
          onChange={(e) => {
            setOptimisticDone(e.target.checked);
            onToggle(task, e.target.checked);
          }}
        />
        <span className="visually-hidden">
          {done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        </span>
      </label>

      <button type="button" className="task-open" aria-haspopup="dialog" onClick={() => onOpen(task)}>
        <span className="task-time">
          <TimeRange task={task} />
        </span>
        <span id={titleId} className="task-title">
          {task.title}
        </span>
        <span className="task-dot" style={{ '--cat': cat.color }} aria-hidden="true" />
        <span className="visually-hidden">
          , {cat.label}
          {done && ', done'}. Open details
        </span>
      </button>
    </li>
  );
}
