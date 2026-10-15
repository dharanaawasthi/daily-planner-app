// Client-side checks that mirror the server's rules, so most mistakes are
// caught before a request is sent. The server stays the source of truth:
// its `details` object uses the same field names and is shown the same way.
import { CATEGORY_NAMES } from './categories.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const FIELD_ORDER = [
  'title',
  'category',
  'scheduledDate',
  'startTime',
  'endTime',
  'durationMinutes',
  'priority',
  'energy',
  'dueDate',
  'notes',
];

export const LIMITS = { title: 200, notes: 5000, minDuration: 5, maxDuration: 480 };

export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const ENERGY_LEVELS = [
  { value: 'deep', label: 'Deep focus' },
  { value: 'normal', label: 'Normal' },
  { value: 'light', label: 'Light' },
];

/** Defaults for a new task's planning fields (form values, so strings). */
export const PLANNING_DEFAULTS = Object.freeze({
  durationMinutes: '60',
  priority: 'medium',
  dueDate: '',
  isFixed: false,
  energy: 'normal',
});

/** Some browsers report time inputs as HH:MM:SS — keep HH:MM. */
const normalizeTime = (value) => (value ? value.slice(0, 5) : '');

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Length of the start–end block in minutes, or null when there isn't a
 * valid block. Used to keep the duration in step with the times.
 */
export function blockMinutes(startTime, endTime) {
  const s = normalizeTime(startTime);
  const e = normalizeTime(endTime);
  if (!TIME_RE.test(s) || !TIME_RE.test(e)) return null;
  const diff = toMinutes(e) - toMinutes(s);
  return diff > 0 ? diff : null;
}

/** Parse the duration field ("60") into an integer, or NaN. */
export function parseDuration(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

/** A difference larger than this (in minutes) triggers the duration warning. */
export const DURATION_WARNING_THRESHOLD = 30;

export const DURATION_WARNING_MESSAGE =
  'Your estimated duration differs from the scheduled time block. You can keep either value or adjust one.';

/**
 * Non-blocking check used by the task form: does the duration estimate differ
 * from the scheduled start–end block by more than 30 minutes?
 *
 * Returns { blockMinutes, durationMinutes, differenceMinutes } when it does,
 * otherwise null. Also null whenever there is nothing sensible to compare —
 * missing or invalid start/end time, an end not after the start, or a duration
 * that isn't a whole number from 5 to 480 — because those cases are reported
 * by validation instead. This covers fixed tasks too: without valid start and
 * end times there is no block, so no warning.
 *
 * This never affects whether a task can be saved.
 */
export function durationConflict({ startTime, endTime, durationMinutes }) {
  const block = blockMinutes(startTime, endTime);
  if (block === null) return null;

  const duration = parseDuration(durationMinutes);
  if (Number.isNaN(duration) || duration < LIMITS.minDuration || duration > LIMITS.maxDuration) return null;

  const differenceMinutes = Math.abs(block - duration);
  if (differenceMinutes <= DURATION_WARNING_THRESHOLD) return null;
  return { blockMinutes: block, durationMinutes: duration, differenceMinutes };
}

export function validateTask(values) {
  const errors = {};
  const title = values.title.trim();
  const startTime = normalizeTime(values.startTime);
  const endTime = normalizeTime(values.endTime);

  if (!title) errors.title = 'Give the task a title.';
  else if (title.length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters.`;

  if (!CATEGORY_NAMES.includes(values.category)) errors.category = 'Choose a category.';

  if (!DATE_RE.test(values.scheduledDate)) errors.scheduledDate = 'Choose a date.';

  if (startTime && !TIME_RE.test(startTime)) errors.startTime = 'Enter a valid start time.';
  else if (values.isFixed && !startTime) errors.startTime = 'A fixed task needs a start time.';

  if (endTime && !TIME_RE.test(endTime)) errors.endTime = 'Enter a valid end time.';
  else if (endTime && !startTime) errors.endTime = 'Add a start time first, or clear the end time.';
  else if (endTime && endTime <= startTime) errors.endTime = 'End time must be after the start time.';

  const duration = parseDuration(values.durationMinutes);
  if (Number.isNaN(duration) || duration < LIMITS.minDuration || duration > LIMITS.maxDuration) {
    errors.durationMinutes = `Enter a whole number of minutes from ${LIMITS.minDuration} to ${LIMITS.maxDuration}.`;
  }

  if (!PRIORITIES.some((p) => p.value === values.priority)) errors.priority = 'Choose a priority.';

  if (values.energy && !ENERGY_LEVELS.some((e) => e.value === values.energy)) errors.energy = 'Choose an energy level.';

  if (values.dueDate && !DATE_RE.test(values.dueDate)) errors.dueDate = 'Enter a valid due date.';

  if (values.notes.length > LIMITS.notes) errors.notes = `Keep notes under ${LIMITS.notes} characters.`;

  return errors;
}

/** Form values -> API body. Empty times become null ("anytime"). */
export function toPayload(values) {
  return {
    title: values.title.trim(),
    category: values.category,
    scheduledDate: values.scheduledDate,
    startTime: normalizeTime(values.startTime) || null,
    endTime: normalizeTime(values.endTime) || null,
    notes: values.notes.trim(),
    durationMinutes: parseDuration(values.durationMinutes),
    priority: values.priority,
    dueDate: values.dueDate || null,
    isFixed: Boolean(values.isFixed),
    energy: values.energy || null,
  };
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;
