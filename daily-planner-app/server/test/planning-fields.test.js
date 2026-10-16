// Planning fields: durationMinutes, priority, dueDate, isFixed, energy.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { resetWithSampleTasks } from '../src/db/seed.js';
import { TEST_USER_ID, startTestServer } from './helpers.js';

const TODAY = '2026-10-15';
let api;

before(async () => {
  api = await startTestServer();
});
after(() => api.close());
beforeEach(() => resetWithSampleTasks(api.db, TEST_USER_ID, TODAY));

const create = (body) => api.post(`/api/tasks?today=${TODAY}`, body);
const findByTitle = async (title) => (await api.get('/api/tasks')).body.find((t) => t.title === title);

describe('defaults', () => {
  test('a new task without planning fields gets 60 min, medium, no due date, not fixed, normal energy', async () => {
    const { status, body } = await create({ title: 'Stretch', category: 'Gym' });
    assert.equal(status, 201);
    assert.equal(body.durationMinutes, 60);
    assert.equal(body.priority, 'medium');
    assert.equal(body.dueDate, null);
    assert.equal(body.isFixed, false);
    assert.equal(body.energy, 'normal');
  });

  test('explicit nulls are kept: energy null = not set, dueDate "" = none', async () => {
    const { body } = await create({ title: 'x', category: 'Study', energy: null, dueDate: '' });
    assert.equal(body.energy, null);
    assert.equal(body.dueDate, null);
  });
});

describe('create with planning fields', () => {
  test('stores and returns every field with the right types', async () => {
    const input = {
      title: 'Dentist', category: 'Personal', scheduledDate: '2026-10-20', startTime: '09:30', endTime: '10:15',
      durationMinutes: 45, priority: 'high', dueDate: '2026-10-20', isFixed: true, energy: 'light',
    };
    const { status, body } = await create(input);
    assert.equal(status, 201);
    for (const [k, v] of Object.entries(input)) assert.deepEqual(body[k], v, k);
    assert.equal(typeof body.isFixed, 'boolean');
  });

  test('isFixed is a boolean in every response shape', async () => {
    const today = (await api.get(`/api/tasks/today?today=${TODAY}`)).body;
    const backlog = (await api.get(`/api/tasks/backlog?today=${TODAY}`)).body;
    const list = (await api.get('/api/tasks')).body;
    for (const t of [...today.open, ...today.completed, ...backlog.tasks, ...list]) {
      assert.equal(typeof t.isFixed, 'boolean', t.title);
    }
  });
});

describe('validation', () => {
  test('rejects bad values for every planning field at once', async () => {
    const { status, body } = await create({
      title: 'x', category: 'Study',
      durationMinutes: 4, priority: 'urgent', dueDate: '2026-02-30', isFixed: 'true', energy: 'high',
    });
    assert.equal(status, 400);
    assert.deepEqual(Object.keys(body.details).sort(), ['dueDate', 'durationMinutes', 'energy', 'isFixed', 'priority']);
  });

  for (const bad of [4, 481, 60.5, '60', null, -10]) {
    test(`durationMinutes ${JSON.stringify(bad)} is rejected`, async () => {
      const { status, body } = await create({ title: 'x', category: 'Study', durationMinutes: bad });
      assert.equal(status, 400);
      assert.ok(body.details.durationMinutes);
    });
  }

  for (const ok of [5, 480]) {
    test(`durationMinutes ${ok} (boundary) is accepted`, async () => {
      assert.equal((await create({ title: 'x', category: 'Study', durationMinutes: ok })).status, 201);
    });
  }

  test('isFixed must be a real boolean (1 and "true" are rejected)', async () => {
    assert.equal((await create({ title: 'x', category: 'Study', isFixed: 1 })).status, 400);
    assert.equal((await create({ title: 'x', category: 'Study', isFixed: 'true' })).status, 400);
  });
});

describe('fixed tasks need a start time', () => {
  test('creating a fixed task without a start time fails on startTime', async () => {
    const { status, body } = await create({ title: 'Call', category: 'Career', isFixed: true });
    assert.equal(status, 400);
    assert.match(body.details.startTime, /fixed task needs a start time/);
  });

  test('clearing the start time of a fixed task fails', async () => {
    const lunch = await findByTitle('Lunch with Sara'); // seeded as fixed
    assert.equal(lunch.isFixed, true);
    const { status } = await api.patch(`/api/tasks/${lunch.id}`, { startTime: null });
    assert.equal(status, 400);
  });

  test('un-fixing and clearing the start time together works', async () => {
    const lunch = await findByTitle('Lunch with Sara');
    const { status, body } = await api.patch(`/api/tasks/${lunch.id}`, { isFixed: false, startTime: null });
    assert.equal(status, 200);
    assert.equal(body.isFixed, false);
    assert.equal(body.startTime, null);
    assert.equal(body.endTime, null);
  });
});

describe('update', () => {
  test('PATCH changes only the planning fields sent', async () => {
    const task = await findByTitle('Call Mom');
    const { status, body } = await api.patch(`/api/tasks/${task.id}`, { priority: 'high', durationMinutes: 15 });
    assert.equal(status, 200);
    assert.equal(body.priority, 'high');
    assert.equal(body.durationMinutes, 15);
    for (const k of ['title', 'category', 'scheduledDate', 'energy', 'dueDate', 'isFixed', 'notes', 'status']) {
      assert.deepEqual(body[k], task[k], k);
    }
  });

  test('completing a task keeps its planning fields', async () => {
    const task = await findByTitle('Review linear algebra lecture notes');
    const { body } = await api.patch(`/api/tasks/${task.id}`, { status: 'completed' });
    assert.ok(body.completedAt);
    for (const k of ['durationMinutes', 'priority', 'dueDate', 'isFixed', 'energy']) assert.deepEqual(body[k], task[k], k);
  });

  test('rescheduling from the backlog keeps planning fields', async () => {
    const task = await findByTitle('Finish problem set 3');
    const { body } = await api.post(`/api/tasks/${task.id}/reschedule?today=${TODAY}`, { date: TODAY });
    assert.equal(body.durationMinutes, 120);
    assert.equal(body.priority, 'high');
    assert.equal(body.dueDate, '2026-10-16');
    assert.equal(body.energy, 'deep');
  });
});

describe('seed data and database constraints', () => {
  test('sample tasks carry planning data', async () => {
    const lunch = await findByTitle('Lunch with Sara');
    assert.deepEqual(
      { durationMinutes: lunch.durationMinutes, priority: lunch.priority, isFixed: lunch.isFixed, energy: lunch.energy },
      { durationMinutes: 60, priority: 'low', isFixed: true, energy: 'light' },
    );
    const bill = await findByTitle('Pay the phone bill');
    assert.equal(bill.dueDate, TODAY);
  });

  test('the database itself rejects out-of-range values', async () => {
    const insert = (cols) =>
      api.db.execute({
        sql: `INSERT INTO tasks (ownerId, title, category, scheduledDate, createdAt, updatedAt, ${Object.keys(cols).join(', ')})
              VALUES ('user_test', 'x', 'Study', '2026-10-01', 'now', 'now', ${Object.keys(cols).map(() => '?').join(', ')})`,
        args: Object.values(cols),
      });
    await assert.rejects(insert({ durationMinutes: 1000 }));
    await assert.rejects(insert({ durationMinutes: 30.5 }));
    await assert.rejects(insert({ priority: 'urgent' }));
    await assert.rejects(insert({ energy: 'high' }));
    await assert.rejects(insert({ dueDate: 'tomorrow' }));
    await assert.rejects(insert({ isFixed: 1 })); // fixed without a start time
    await assert.doesNotReject(insert({ isFixed: 1, startTime: '09:00' }));
  });
});
