const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n) => String(n).padStart(2, '0');

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True for a 24-hour HH:MM time (00:00 – 23:59). */
export function isValidTime(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** Today's date in the server's local time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * True when a date sent by a browser as "my today" could really be today
 * somewhere on Earth: time zones run from UTC−12 to UTC+14, so it must be
 * within one day of the current UTC date.
 */
export function isPlausibleLocalDate(value, now = new Date()) {
  if (!isValidDate(value)) return false;
  const utcToday = now.toISOString().slice(0, 10);
  return value >= addDays(utcToday, -1) && value <= addDays(utcToday, 1);
}

/** Add (or subtract) whole days to a YYYY-MM-DD date. */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Current instant as an ISO-8601 UTC timestamp, used for createdAt etc. */
export const nowIso = () => new Date().toISOString();
