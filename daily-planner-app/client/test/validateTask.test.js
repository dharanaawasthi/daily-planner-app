import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DURATION_WARNING_MESSAGE,
  DURATION_WARNING_THRESHOLD,
  PLANNING_DEFAULTS,
  blockMinutes,
  durationConflict,
  toPayload,
  validateTask,
} from '../src/lib/validateTask.js';

const base = {
  title: 'Read',
  category: 'Study',
  scheduledDate: '2026-10-15',
  startTime: '',
  endTime: '',
  notes: '',
  ...PLANNING_DEFAULTS,
};

describe('form defaults', () => {
  test('60 minutes, medium priority, not fixed, normal energy, no due date', () => {
    assert.deepEqual(PLANNING_DEFAULTS, {
      durationMinutes: '60',
      priority: 'medium',
      dueDate: '',
      isFixed: false,
      energy: 'normal',
    });
    assert.deepEqual(validateTask(base), {});
  });
});

describe('planning field validation', () => {
  for (const bad of ['', '4', '481', '60.5', 'abc', '-10']) {
    test(`duration "${bad}" is rejected`, () => {
      assert.ok(validateTask({ ...base, durationMinutes: bad }).durationMinutes);
    });
  }

  test('fixed without a start time is reported on the start time', () => {
    assert.match(validateTask({ ...base, isFixed: true }).startTime, /fixed task needs a start time/);
    assert.deepEqual(validateTask({ ...base, isFixed: true, startTime: '09:00' }), {});
  });

  test('energy may be "Not set" (empty)', () => {
    assert.deepEqual(validateTask({ ...base, energy: '' }), {});
    assert.ok(validateTask({ ...base, energy: 'extreme' }).energy);
  });
});

describe('payload', () => {
  test('converts form strings to API types', () => {
    const payload = toPayload({ ...base, durationMinutes: '45', energy: '', dueDate: '', startTime: '09:00:00' });
    assert.equal(payload.durationMinutes, 45);
    assert.equal(payload.energy, null);
    assert.equal(payload.dueDate, null);
    assert.equal(payload.isFixed, false);
    assert.equal(payload.startTime, '09:00');
  });
});

describe('duration from a time block', () => {
  test('length of a valid block, null otherwise', () => {
    assert.equal(blockMinutes('09:00', '10:30'), 90);
    assert.equal(blockMinutes('10:00', '09:00'), null);
    assert.equal(blockMinutes('09:00', ''), null);
  });
});

describe('duration warning (estimate vs. scheduled time block)', () => {
  // 09:00–10:30 is a 90-minute block.
  const block = { startTime: '09:00', endTime: '10:30' };

  test('threshold is 30 minutes and the message is the agreed wording', () => {
    assert.equal(DURATION_WARNING_THRESHOLD, 30);
    assert.equal(
      DURATION_WARNING_MESSAGE,
      'Your estimated duration differs from the scheduled time block. You can keep either value or adjust one.',
    );
  });

  test('no warning when the estimate matches the block', () => {
    assert.equal(durationConflict({ ...block, durationMinutes: '90' }), null);
  });

  test('exactly 30 minutes apart: no warning (shorter or longer)', () => {
    assert.equal(durationConflict({ ...block, durationMinutes: '60' }), null);
    assert.equal(durationConflict({ ...block, durationMinutes: '120' }), null);
  });

  test('31 minutes apart: warning (shorter or longer)', () => {
    assert.deepEqual(durationConflict({ ...block, durationMinutes: '59' }), {
      blockMinutes: 90,
      durationMinutes: 59,
      differenceMinutes: 31,
    });
    assert.deepEqual(durationConflict({ ...block, durationMinutes: '121' }), {
      blockMinutes: 90,
      durationMinutes: 121,
      differenceMinutes: 31,
    });
  });

  test('larger differences: warning', () => {
    assert.equal(durationConflict({ ...block, durationMinutes: '5' }).differenceMinutes, 85);
    assert.equal(durationConflict({ startTime: '08:00', endTime: '17:00', durationMinutes: '60' }).differenceMinutes, 480);
  });

  test('accepts a number as well as form text', () => {
    assert.equal(durationConflict({ ...block, durationMinutes: 59 }).differenceMinutes, 31);
  });

  test('no warning without a start time, an end time, or both', () => {
    assert.equal(durationConflict({ startTime: '', endTime: '', durationMinutes: '15' }), null);
    assert.equal(durationConflict({ startTime: '09:00', endTime: '', durationMinutes: '15' }), null);
    assert.equal(durationConflict({ startTime: '', endTime: '10:30', durationMinutes: '15' }), null);
    assert.equal(durationConflict({ startTime: null, endTime: null, durationMinutes: 15 }), null);
  });

  test('no warning when the times are invalid (end not after start)', () => {
    assert.equal(durationConflict({ startTime: '10:30', endTime: '09:00', durationMinutes: '15' }), null);
    assert.equal(durationConflict({ startTime: '10:00', endTime: '10:00', durationMinutes: '120' }), null);
  });

  test('no warning when the duration itself is invalid (validation reports it instead)', () => {
    for (const bad of ['', 'abc', '4', '481', '60.5']) {
      assert.equal(durationConflict({ ...block, durationMinutes: bad }), null, bad);
    }
  });

  test('fixed tasks: no warning without valid start and end times', () => {
    assert.equal(durationConflict({ startTime: '', endTime: '', durationMinutes: '15', isFixed: true }), null);
    assert.equal(durationConflict({ startTime: '09:00', endTime: '', durationMinutes: '15', isFixed: true }), null);
  });

  test('fixed tasks with a valid block are compared like any other task', () => {
    assert.equal(durationConflict({ ...block, durationMinutes: '15', isFixed: true }).differenceMinutes, 75);
  });

  test('the warning never blocks saving: validation passes when only the warning applies', () => {
    const values = { ...base, ...block, durationMinutes: '15' };
    assert.ok(durationConflict(values));
    assert.deepEqual(validateTask(values), {});
  });
});
