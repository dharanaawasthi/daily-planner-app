import { useEffect, useState } from 'react';
import { formatTime } from '../lib/dates.js';
import CategoryChip from './CategoryChip.jsx';
import TaskMeta from './TaskMeta.jsx';
import { PencilIcon, TrashIcon } from './icons.jsx';

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
 * One row in Today or Completed: checkbox, time, title/notes, Edit, Delete.
 * Completed rows are marked by a checked box with a check icon, a
 * strikethrough title and a "Done" tag — never by color alone.
 */
export default function TaskItem({ task, today, busy, onToggle, onEdit, onDelete }) {
  const done = task.status === 'completed';
  const titleId = `task-${task.id}-title`;

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

      <div className="task-time">
        <TimeRange task={task} />
      </div>

      <div className="task-body">
        <p id={titleId} className="task-title">
          {task.title}
        </p>
        {task.notes && <p className="task-notes">{task.notes}</p>}
        <p className="task-tags">
          <CategoryChip category={task.category} />
          {done && <span className="done-tag">Done</span>}
          <TaskMeta task={task} today={today} />
        </p>
      </div>

      <div className="task-actions">
        <button
          type="button"
          className="btn btn-quiet btn-xs"
          onClick={() => onEdit(task)}
          disabled={busy}
          aria-label={`Edit “${task.title}”`}
        >
          <PencilIcon width={15} height={15} />
          Edit
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-xs btn-delete"
          onClick={() => onDelete(task)}
          disabled={busy}
          aria-label={`Delete “${task.title}”`}
        >
          <TrashIcon width={15} height={15} />
          Delete
        </button>
      </div>
    </li>
  );
}
