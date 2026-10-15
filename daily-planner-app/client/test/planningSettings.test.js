import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SETTINGS_KEY,
  dayLengthMinutes,
  defaultSettings,
  loadSettings,
  saveSettings,
  validateSettings,
} from '../src/lib/planningSettings.js';

const TODAY = '2026-10-15';

/** In-memory stand-in for localStorage. */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
}

const valid = { planningDate: TODAY, dayStart: '07:30', dayEnd: '17:00', preferDeepWorkBeforeNoon: true };

describe('defaults', () => {
  test('plan today, 08:00–18:00, deep-focus preference off', () => {
    assert.deepEqual(defaultSettings(TODAY), {
      planningDate: TODAY,
      dayStart: '08:00',
      dayEnd: '18:00',
      preferDeepWorkBeforeNoon: false,
    });
  });

  test('nothing saved -> defaults', () => {
    assert.deepEqual(loadSettings(memoryStorage(), TODAY), defaultSettings(TODAY));
  });
});

describe('save and load', () => {
  test('round-trips through storage', () => {
    const storage = memoryStorage();
    assert.deepEqual(saveSettings(storage, valid, TODAY), { ok: true });
    assert.deepEqual(loadSettings(storage, TODAY), valid);
  });

  test('a future planning date is kept', () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...valid, planningDate: '2026-10-16' }, TODAY);
    assert.equal(loadSettings(storage, TODAY).planningDate, '2026-10-16');
  });

  test('a planning date that has passed becomes today; other settings are kept', () => {
    const storage = memoryStorage();
    saveSettings(storage, valid, TODAY);
    const nextWeek = loadSettings(storage, '2026-10-22');
    assert.equal(nextWeek.planningDate, '2026-10-22');
    assert.equal(nextWeek.dayStart, '07:30');
    assert.equal(nextWeek.preferDeepWorkBeforeNoon, true);
  });

  test('invalid settings are not saved', () => {
    const storage = memoryStorage();
    const result = saveSettings(storage, { ...valid, dayEnd: '07:00' }, TODAY);
    assert.equal(result.ok, false);
    assert.ok(result.errors.dayEnd);
    assert.equal(storage.getItem(SETTINGS_KEY), null);
  });

  test('a browser that refuses storage is reported, not thrown', () => {
    const blocked = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    assert.deepEqual(saveSettings(blocked, valid, TODAY), { ok: false, storageError: true });
  });
});

describe('repairing bad saved data', () => {
  test('unreadable JSON -> defaults', () => {
    const storage = memoryStorage({ [SETTINGS_KEY]: '{not json' });
    assert.deepEqual(loadSettings(storage, TODAY), defaultSettings(TODAY));
  });

  test('storage that throws on read -> defaults', () => {
    const storage = { getItem: () => { throw new Error('SecurityError'); } };
    assert.deepEqual(loadSettings(storage, TODAY), defaultSettings(TODAY));
  });

  test('one bad field falls back alone', () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ ...valid, preferDeepWorkBeforeNoon: 'yes' }),
    });
    const loaded = loadSettings(storage, TODAY);
    assert.equal(loaded.preferDeepWorkBeforeNoon, false);
    assert.equal(loaded.dayStart, '07:30');
  });

  test('an inverted day window falls back to the default window', () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ ...valid, dayStart: '19:00', dayEnd: '09:00' }),
    });
    const loaded = loadSettings(storage, TODAY);
    assert.equal(loaded.dayStart, '08:00');
    assert.equal(loaded.dayEnd, '18:00');
  });
});

describe('validation', () => {
  test('valid settings have no errors', () => {
    assert.deepEqual(validateSettings(valid, TODAY), {});
  });

  test('catches each problem', () => {
    assert.ok(validateSettings({ ...valid, planningDate: '2026-02-30' }, TODAY).planningDate);
    assert.ok(validateSettings({ ...valid, planningDate: '2026-10-14' }, TODAY).planningDate, 'past date');
    assert.ok(validateSettings({ ...valid, dayStart: '25:00' }, TODAY).dayStart);
    assert.ok(validateSettings({ ...valid, dayEnd: '07:30' }, TODAY).dayEnd, 'end equals start');
    assert.ok(validateSettings({ ...valid, dayEnd: '08:00' }, TODAY).dayEnd, 'shorter than an hour');
    assert.ok(validateSettings({ ...valid, preferDeepWorkBeforeNoon: 1 }, TODAY).preferDeepWorkBeforeNoon);
  });

  test('day length in minutes', () => {
    assert.equal(dayLengthMinutes(valid), 570);
    assert.equal(dayLengthMinutes({ dayStart: '18:00', dayEnd: '08:00' }), 0);
  });
});
