const pad = (n) => String(n).padStart(2, '0');

const toLocalDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Today's date as YYYY-MM-DD in the browser's own time zone. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Add (or subtract) whole days to a YYYY-MM-DD date. */
export function addDays(iso, days) {
  const dt = toLocalDate(iso);
  dt.setDate(dt.getDate() + days);
  return todayISO(dt);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from, to) {
  return Math.round((toLocalDate(to) - toLocalDate(from)) / 86_400_000);
}

/** "2026-10-15" -> "Thursday, October 15" */
export function formatLongDate(iso) {
  return toLocalDate(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** "2026-10-14" -> "Wed, Oct 14" */
export function formatShortDate(iso) {
  return toLocalDate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "Yesterday", "3 days ago", "Tomorrow", or a short date. */
export function relativeDay(iso, today) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0 && diff >= -6) return `${-diff} days ago`;
  return formatShortDate(iso);
}

/** 45 -> "45 min", 60 -> "1 h", 90 -> "1 h 30 min" */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Due-date wording relative to today: "Due today", "Overdue · was due Wed, Oct 14", … */
export function describeDue(dueDate, today) {
  if (!dueDate) return null;
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return { text: `Overdue · was due ${formatShortDate(dueDate)}`, overdue: true };
  if (diff === 0) return { text: 'Due today', overdue: false };
  if (diff === 1) return { text: 'Due tomorrow', overdue: false };
  return { text: `Due ${formatShortDate(dueDate)}`, overdue: false };
}

/** "14:05" -> "2:05 PM" (locale-aware) */
export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
