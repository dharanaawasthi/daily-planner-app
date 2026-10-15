import { useId, useState } from 'react';
import { addDays, formatShortDate, formatTime, relativeDay } from '../lib/dates.js';
import CategoryChip from './CategoryChip.jsx';
import TaskMeta from './TaskMeta.jsx';
import { CalendarIcon, ClockIcon } from './icons.jsx';

/** An open task from a previous day, with Schedule today / Pick date / Dismiss. */
export default function BacklogItem({ task, today, busy, onScheduleToday, onReschedule, onDismiss }) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(() => addDays(today, 1));
  const [dateError, setDateError] = useState(null);

  // "Overdue" is said in words (and with an icon), not only with color.
  const when = [relativeDay(task.scheduledDate, today), task.startTime && formatTime(task.startTime)]
    .filter(Boolean)
    .join(' · ');

  async function submitDate(e) {
    e.preventDefault();
    if (!date) return setDateError('Choose a date.');
    if (date < today) return setDateError('Choose today or a later date.');
    setDateError(null);
    const ok = await onReschedule(task, date);
    if (ok) setPicking(false);
  }

  return (
    <li className={`backlog-item${busy ? ' is-busy' : ''}`} aria-labelledby={titleId} aria-busy={busy || undefined}>
      <div className="backlog-main">
        <p id={titleId} className="task-title">
          {task.title}
        </p>
        <p className="backlog-meta">
          <CategoryChip category={task.category} />
          <span className="overdue" title={formatShortDate(task.scheduledDate)}>
            <ClockIcon width={13} height={13} />
            <span className="visually-hidden">Overdue, was scheduled </span>
            {when}
          </span>
          <TaskMeta task={task} today={today} />
        </p>
      </div>

      {picking ? (
        <form
          className="date-picker"
          noValidate
          onSubmit={submitDate}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setPicking(false);
            }
          }}
        >
          <label htmlFor={`${uid}-date`} className="visually-hidden">
            New date for “{task.title}”
          </label>
          <input
            id={`${uid}-date`}
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setDateError(null);
            }}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? `${uid}-date-error` : undefined}
            autoFocus
          />
          <div className="date-picker-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              Move
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
          {dateError && (
            <p id={`${uid}-date-error`} className="field-error">
              {dateError}
            </p>
          )}
        </form>
      ) : (
        <div className="backlog-actions" role="group" aria-label={`Actions for “${task.title}”`}>
          <button type="button" className="btn btn-primary-soft btn-sm" onClick={() => onScheduleToday(task)} disabled={busy}>
            Schedule today
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)} disabled={busy}>
            <CalendarIcon width={15} height={15} />
            Pick date
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDismiss(task)} disabled={busy}>
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
