// Planning settings: what day to plan and the working window for it.
// Stored on this device (localStorage). No schedule is generated yet —
// these settings are the input a future planner will read.
//
// Pure functions with the storage object passed in, so they can be
// unit-tested without a browser.

export const SETTINGS_KEY = 'planner.planningSettings.v1';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MIN_DAY_MINUTES = 60;

export function defaultSettings(today) {
  return {
    planningDate: today,
    dayStart: '08:00',
    dayEnd: '18:00',
    preferDeepWorkBeforeNoon: false,
  };
}

const isRealDate = (v) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const isTime = (v) => typeof v === 'string' && TIME_RE.test(v);
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Length of the planning window in minutes (0 if invalid). */
export function dayLengthMinutes({ dayStart, dayEnd }) {
  if (!isTime(dayStart) || !isTime(dayEnd)) return 0;
  return Math.max(0, minutes(dayEnd) - minutes(dayStart));
}

/** Field -> message for anything invalid. `today` enables the "not in the past" rule. */
export function validateSettings(settings, today) {
  const errors = {};
  if (!isRealDate(settings.planningDate)) errors.planningDate = 'Choose a date to plan.';
  else if (today && settings.planningDate < today) errors.planningDate = 'Choose today or a later date.';

  if (!isTime(settings.dayStart)) errors.dayStart = 'Enter a start time.';
  if (!isTime(settings.dayEnd)) errors.dayEnd = 'Enter an end time.';
  else if (isTime(settings.dayStart)) {
    const length = minutes(settings.dayEnd) - minutes(settings.dayStart);
    if (length <= 0) errors.dayEnd = 'The day must end after it starts.';
    else if (length < MIN_DAY_MINUTES) errors.dayEnd = `Leave at least ${MIN_DAY_MINUTES} minutes to plan.`;
  }

  if (typeof settings.preferDeepWorkBeforeNoon !== 'boolean') {
    errors.preferDeepWorkBeforeNoon = 'Choose on or off.';
  }
  return errors;
}

/**
 * Read saved settings, repairing anything unusable instead of failing:
 *  - nothing saved, unreadable JSON, or storage blocked -> defaults
 *  - a single bad field -> that field's default
 *  - a planning date in the past (saved on an earlier day) -> today
 *  - a start/end pair that doesn't make a valid window -> default window
 */
export function loadSettings(storage, today) {
  const defaults = defaultSettings(today);
  let saved;
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    saved = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!saved || typeof saved !== 'object') return defaults;

  const settings = {
    planningDate: isRealDate(saved.planningDate) && saved.planningDate >= today ? saved.planningDate : defaults.planningDate,
    dayStart: isTime(saved.dayStart) ? saved.dayStart : defaults.dayStart,
    dayEnd: isTime(saved.dayEnd) ? saved.dayEnd : defaults.dayEnd,
    preferDeepWorkBeforeNoon:
      typeof saved.preferDeepWorkBeforeNoon === 'boolean' ? saved.preferDeepWorkBeforeNoon : defaults.preferDeepWorkBeforeNoon,
  };

  if (validateSettings(settings).dayEnd) {
    settings.dayStart = defaults.dayStart;
    settings.dayEnd = defaults.dayEnd;
  }
  return settings;
}

/**
 * Save settings. Returns { ok: true } or { ok: false, errors } for invalid
 * input, or { ok: false, storageError: true } if the browser refused to store.
 */
export function saveSettings(storage, settings, today) {
  const errors = validateSettings(settings, today);
  if (Object.keys(errors).length) return { ok: false, errors };
  try {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        planningDate: settings.planningDate,
        dayStart: settings.dayStart,
        dayEnd: settings.dayEnd,
        preferDeepWorkBeforeNoon: settings.preferDeepWorkBeforeNoon,
      }),
    );
    return { ok: true };
  } catch {
    return { ok: false, storageError: true };
  }
}
