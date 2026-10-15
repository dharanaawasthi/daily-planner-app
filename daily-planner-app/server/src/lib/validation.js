import { isValidDate, isValidTime } from './dates.js';

export const CATEGORIES = ['Study', 'Gym', 'Career', 'Personal'];
export const STATUSES = ['open', 'completed', 'dismissed'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const ENERGY_LEVELS = ['deep', 'normal', 'light'];

export const LIMITS = { title: 200, notes: 5000, minDuration: 5, maxDuration: 480 };

/** Values used when a new task doesn't specify a planning field. */
export const PLANNING_DEFAULTS = Object.freeze({
  durationMinutes: 60,
  priority: 'medium',
  dueDate: null,
  isFixed: false,
  energy: 'normal',
});

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Match a category case-insensitively and return its canonical spelling. */
export function normalizeCategory(value) {
  if (typeof value !== 'string') return null;
  const wanted = value.trim().toLowerCase();
  return CATEGORIES.find((c) => c.toLowerCase() === wanted) ?? null;
}

/**
 * Validate the user-editable fields of a task request body.
 *
 * - `partial: false` (create): title and category are required.
 * - `partial: true`  (update): only the fields present are checked.
 *
 * Read-only fields (id, completedAt, createdAt, updatedAt) and unknown fields
 * are ignored, so a client can safely send a whole task object back.
 * Defaults for omitted fields are applied by the repository, not here.
 *
 * Returns { values, errors } where `errors` maps field -> message.
 */
export function parseTaskInput(body, { partial }) {
  const values = {};
  const errors = {};

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { values, errors: { body: 'Request body must be a JSON object' } };
  }

  // title
  if (has(body, 'title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) errors.title = 'Title is required';
    else if (title.length > LIMITS.title) errors.title = `Title must be ${LIMITS.title} characters or fewer`;
    else values.title = title;
  } else if (!partial) {
    errors.title = 'Title is required';
  }

  // category
  if (has(body, 'category')) {
    const category = normalizeCategory(body.category);
    if (!category) errors.category = `Category must be one of: ${CATEGORIES.join(', ')}`;
    else values.category = category;
  } else if (!partial) {
    errors.category = 'Category is required';
  }

  // scheduledDate (optional on create — the route defaults it to today)
  if (has(body, 'scheduledDate')) {
    if (!isValidDate(body.scheduledDate)) errors.scheduledDate = 'Date must be a real date in YYYY-MM-DD format';
    else values.scheduledDate = body.scheduledDate;
  }

  // startTime / endTime — null or "" means "no scheduled time"
  for (const field of ['startTime', 'endTime']) {
    if (!has(body, field)) continue;
    const value = body[field];
    if (value === null || value === '') values[field] = null;
    else if (!isValidTime(value)) errors[field] = 'Time must be in 24-hour HH:MM format';
    else values[field] = value;
  }

  // notes
  if (has(body, 'notes')) {
    const notes = body.notes ?? '';
    if (typeof notes !== 'string') errors.notes = 'Notes must be text';
    else if (notes.length > LIMITS.notes) errors.notes = `Notes must be ${LIMITS.notes} characters or fewer`;
    else values.notes = notes;
  }

  // status
  if (has(body, 'status')) {
    if (!STATUSES.includes(body.status)) errors.status = `Status must be one of: ${STATUSES.join(', ')}`;
    else values.status = body.status;
  }

  // ── Planning fields ────────────────────────────────────────────────────

  // durationMinutes — a whole number of minutes, 5–480 (8 hours)
  if (has(body, 'durationMinutes')) {
    const d = body.durationMinutes;
    if (!Number.isInteger(d) || d < LIMITS.minDuration || d > LIMITS.maxDuration) {
      errors.durationMinutes = `Duration must be a whole number of minutes from ${LIMITS.minDuration} to ${LIMITS.maxDuration}`;
    } else {
      values.durationMinutes = d;
    }
  }

  // priority
  if (has(body, 'priority')) {
    if (!PRIORITIES.includes(body.priority)) errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}`;
    else values.priority = body.priority;
  }

  // dueDate — null or "" clears it
  if (has(body, 'dueDate')) {
    const value = body.dueDate;
    if (value === null || value === '') values.dueDate = null;
    else if (!isValidDate(value)) errors.dueDate = 'Due date must be a real date in YYYY-MM-DD format';
    else values.dueDate = value;
  }

  // isFixed — a real boolean (not "true", not 1)
  if (has(body, 'isFixed')) {
    if (typeof body.isFixed !== 'boolean') errors.isFixed = 'isFixed must be true or false';
    else values.isFixed = body.isFixed;
  }

  // energy — null means "not set"
  if (has(body, 'energy')) {
    const value = body.energy;
    if (value === null) values.energy = null;
    else if (!ENERGY_LEVELS.includes(value)) errors.energy = `Energy must be one of: ${ENERGY_LEVELS.join(', ')}, or null`;
    else values.energy = value;
  }

  return { values, errors };
}

/** Cross-field rules checked on the final (merged) task. */
export function checkTaskRules({ startTime, endTime, isFixed }) {
  const errors = {};
  if (endTime && !startTime) errors.endTime = 'Set a start time before adding an end time';
  else if (endTime && endTime <= startTime) errors.endTime = 'End time must be after the start time';
  if (isFixed && !startTime) errors.startTime = 'A fixed task needs a start time';
  return errors;
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;
