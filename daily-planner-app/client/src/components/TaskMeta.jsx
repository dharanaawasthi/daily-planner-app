import { describeDue, formatDuration } from '../lib/dates.js';
import { BoltIcon, ClockIcon, FlagIcon, LockIcon } from './icons.jsx';

/**
 * Planning details for a task row, in words with an icon each. Defaults
 * (medium priority, normal energy) are left out to keep rows calm.
 */
export default function TaskMeta({ task, today, showDuration = true }) {
  const due = describeDue(task.dueDate, today);
  const items = [];

  if (showDuration && task.durationMinutes) {
    items.push(
      <span key="duration" className="meta-item">
        <ClockIcon width={13} height={13} />
        {formatDuration(task.durationMinutes)}
      </span>,
    );
  }
  if (task.priority === 'high' || task.priority === 'low') {
    items.push(
      <span key="priority" className={`meta-item priority-${task.priority}`}>
        <FlagIcon width={13} height={13} />
        {task.priority === 'high' ? 'High priority' : 'Low priority'}
      </span>,
    );
  }
  if (task.isFixed) {
    items.push(
      <span key="fixed" className="meta-item">
        <LockIcon width={13} height={13} />
        Fixed
      </span>,
    );
  }
  if (task.energy === 'deep' || task.energy === 'light') {
    items.push(
      <span key="energy" className="meta-item">
        <BoltIcon width={13} height={13} />
        {task.energy === 'deep' ? 'Deep focus' : 'Light'}
      </span>,
    );
  }
  if (due) {
    items.push(
      <span key="due" className={`meta-item${due.overdue ? ' is-overdue' : ''}`}>
        {due.text}
      </span>,
    );
  }

  if (!items.length) return null;
  return <span className="task-meta">{items}</span>;
}
