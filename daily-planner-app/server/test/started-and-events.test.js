// The "started" state and the privacy-safe event log: starting a task, only
// one started task per user, completing and unticking, rescheduling and
// dismissing a started task, the events each action writes (never any task
// text), app_opened once per user per day, and isolation between users.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createTaskRepository } from '../src/db/taskRepository.js';
import { addDays, isPlausibleLocalDate } from '../src/lib/dates.js';
import { all, one, startTestServer } from './helpers.js';

// app_opened only accepts a date that could really be today, so these tests
// use the real current date.
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const ALICE = 'user_alice';
const BOB = 'user_bob';
const SECRET_TITLE = 'Secret title zebra';
const SECRET_NOTES = 'Secret notes giraffe';

let api;
let alice;
let bob;

before(async () => {
  api = await startTestServer();
  alice = api.asUser(ALICE);
  bob = api.asUser(BOB);
});
after(() => api.close());

beforeEach(async () => {
  await api.db.batch(['DELETE FROM tasks', 'DELETE FROM task_events'], 'write');
});

const q = `?today=${TODAY}`;

async function createTask(user, fields = {}) {
  const res = await user.post(`/api/tasks${q}`, {
    title: SECRET_TITLE, notes: SECRET_NOTES, category: 'Study', ...fields,
  });
  assert.equal(res.status, 201);
  return res.body;
}

const start = (user, id) => user.post(`/api/tasks/${id}/start${q}`);
const setStatus = (user, id, status) => user.patch(`/api/tasks/${id}${q}`, { status });
const statusOf = async (id) => (await one(api.db, 'SELECT status FROM tasks WHERE id = ?', [id])).status;

/** Events as [type, taskId] pairs, oldest first, optionally from one task. */
async function events({ ownerId, taskId, types } = {}) {
  const rows = await all(api.db, 'SELECT * FROM task_events ORDER BY id');
  return rows
    .filter((e) => (ownerId === undefined || e.ownerId === ownerId) && (taskId === undefined || e.taskId === taskId))
    .filter((e) => !types || types.includes(e.type))
    .map((e) => [e.type, e.taskId]);
}

describe('starting a task', () => {
  test('sets status started and startedAt to now', async () => {
    const task = await createTask(alice);
    assert.equal(task.startedAt, null);

    const beforeStart = new Date().toISOString();
    const res = await start(alice, task.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'started');
    assert.ok(res.body.startedAt >= beforeStart, 'startedAt is the time of the start');
    assert.equal(res.body.completedAt, null);
  });

  test('starting another task moves the first back to open; only one is started', async () => {
    const first = await createTask(alice);
    const second = await createTask(alice);
    await start(alice, first.id);
    await start(alice, second.id);

    assert.equal(await statusOf(first.id), 'open');
    assert.equal(await statusOf(second.id), 'started');
    assert.equal((await one(api.db, "SELECT COUNT(*) AS n FROM tasks WHERE ownerId = ? AND status = 'started'", [ALICE])).n, 1);
    // The paused task keeps its startedAt (it was started before).
    assert.ok((await one(api.db, 'SELECT startedAt FROM tasks WHERE id = ?', [first.id])).startedAt);
  });

  test('restarting a paused task overwrites startedAt', async () => {
    const first = await createTask(alice);
    const second = await createTask(alice);
    const firstStart = (await start(alice, first.id)).body.startedAt;
    await start(alice, second.id);
    await new Promise((r) => setTimeout(r, 5));
    const restarted = (await start(alice, first.id)).body;
    assert.equal(restarted.status, 'started');
    assert.ok(restarted.startedAt > firstStart);
  });

  test('starting an already started task changes nothing and logs nothing', async () => {
    const task = await createTask(alice);
    const first = (await start(alice, task.id)).body;
    const again = await start(alice, task.id);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, first);
    assert.deepEqual(await events({ types: ['task_started'] }), [['task_started', task.id]]);
  });

  test('completed and dismissed tasks cannot be started (409)', async () => {
    const done = await createTask(alice);
    await setStatus(alice, done.id, 'completed');
    const dropped = await createTask(alice);
    await alice.post(`/api/tasks/${dropped.id}/dismiss${q}`);

    assert.equal((await start(alice, done.id)).status, 409);
    assert.equal((await start(alice, dropped.id)).status, 409);
    assert.equal(await statusOf(done.id), 'completed');
    assert.equal(await statusOf(dropped.id), 'dismissed');
  });

  test('a missing task or a bad id is 404', async () => {
    assert.equal((await start(alice, 9999)).status, 404);
    assert.equal((await start(alice, 'abc')).status, 404);
  });

  test('status "started" cannot be set through create or PATCH (use /start)', async () => {
    const created = await alice.post(`/api/tasks${q}`, { title: 'x', category: 'Study', status: 'started' });
    assert.equal(created.status, 400);
    assert.match(created.body.details.status, /\/start/);

    const task = await createTask(alice);
    const patched = await setStatus(alice, task.id, 'started');
    assert.equal(patched.status, 400);
    assert.match(patched.body.details.status, /\/start/);
    assert.equal(await statusOf(task.id), 'open');
  });

  test('GET /api/tasks accepts status=started', async () => {
    const task = await createTask(alice);
    await createTask(alice);
    await start(alice, task.id);
    const res = await alice.get('/api/tasks?status=started');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((t) => t.id), [task.id]);
  });
});

describe('completing and unticking', () => {
  test('complete works from open and from started in one call', async () => {
    const open = await createTask(alice);
    const started = await createTask(alice);
    await start(alice, started.id);

    for (const task of [open, started]) {
      const res = await setStatus(alice, task.id, 'completed');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'completed');
      assert.ok(res.body.completedAt);
    }
  });

  test('untick: back to started when it was started and nothing else is started', async () => {
    const task = await createTask(alice);
    const { startedAt } = (await start(alice, task.id)).body;
    await setStatus(alice, task.id, 'completed');

    const res = await setStatus(alice, task.id, 'open');
    assert.equal(res.body.status, 'started');
    assert.equal(res.body.startedAt, startedAt);
    assert.equal(res.body.completedAt, null);
  });

  test('untick: back to open when another task is started now', async () => {
    const task = await createTask(alice);
    const other = await createTask(alice);
    await start(alice, task.id);
    await setStatus(alice, task.id, 'completed');
    await start(alice, other.id);

    assert.equal((await setStatus(alice, task.id, 'open')).body.status, 'open');
    assert.equal(await statusOf(other.id), 'started', 'the other task stays started');
  });

  test('untick: back to open when the task was never started', async () => {
    const task = await createTask(alice);
    await setStatus(alice, task.id, 'completed');
    assert.equal((await setStatus(alice, task.id, 'open')).body.status, 'open');
  });

  test("another user's started task does not block unticking back to started", async () => {
    const task = await createTask(alice);
    await start(alice, task.id);
    await setStatus(alice, task.id, 'completed');
    const bobs = await createTask(bob);
    await start(bob, bobs.id);
    assert.equal((await setStatus(alice, task.id, 'open')).body.status, 'started');
  });
});

describe('rescheduling, dismissing and editing a started task', () => {
  test('reschedule is allowed and leaves started', async () => {
    const task = await createTask(alice);
    await start(alice, task.id);
    const res = await alice.post(`/api/tasks/${task.id}/reschedule${q}`, { date: TOMORROW });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'open');
    assert.equal(res.body.scheduledDate, TOMORROW);
  });

  test('dismiss is allowed and leaves started', async () => {
    const task = await createTask(alice);
    await start(alice, task.id);
    const res = await alice.post(`/api/tasks/${task.id}/dismiss${q}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'dismissed');
  });

  test('editing without changing the date keeps it started', async () => {
    const task = await createTask(alice);
    await start(alice, task.id);
    const res = await alice.patch(`/api/tasks/${task.id}${q}`, { title: 'Renamed', scheduledDate: TODAY, priority: 'high' });
    assert.equal(res.body.status, 'started');
  });

  test('changing the date in the edit form leaves started', async () => {
    const task = await createTask(alice);
    await start(alice, task.id);
    const res = await alice.patch(`/api/tasks/${task.id}${q}`, { scheduledDate: TOMORROW });
    assert.equal(res.body.status, 'open');
  });

  test('completed tasks still cannot be rescheduled or dismissed (409)', async () => {
    const task = await createTask(alice);
    await setStatus(alice, task.id, 'completed');
    assert.equal((await alice.post(`/api/tasks/${task.id}/reschedule${q}`, { date: TOMORROW })).status, 409);
    assert.equal((await alice.post(`/api/tasks/${task.id}/dismiss${q}`)).status, 409);
  });
});

describe('started tasks are not-yet-done tasks everywhere', () => {
  test("Today: started is in the open list, pinned first, the rest by start time", async () => {
    const late = await createTask(alice, { startTime: '16:00' });
    const early = await createTask(alice, { startTime: '08:00' });
    const anytime = await createTask(alice);
    const done = await createTask(alice, { startTime: '07:00' });
    await setStatus(alice, done.id, 'completed');
    await start(alice, late.id);

    const { body } = await alice.get(`/api/tasks/today${q}`);
    assert.deepEqual(body.open.map((t) => t.id), [late.id, early.id, anytime.id]);
    assert.equal(body.open[0].status, 'started');
    assert.deepEqual(body.completed.map((t) => t.id), [done.id]);
  });

  test('Backlog: a started task from an earlier day is included and pinned first', async () => {
    const older = await createTask(alice, { scheduledDate: addDays(TODAY, -3) });
    const started = await createTask(alice, { scheduledDate: YESTERDAY });
    await start(alice, started.id);

    const { body } = await alice.get(`/api/tasks/backlog${q}`);
    assert.deepEqual(body.tasks.map((t) => t.id), [started.id, older.id]);
  });
});

describe('events written by the server', () => {
  test('every action writes its event with the right type, owner, task and date', async () => {
    const task = await createTask(alice);
    const other = await createTask(alice);
    await start(alice, task.id);
    await start(alice, other.id); // pauses task
    await setStatus(alice, other.id, 'completed');
    await setStatus(alice, other.id, 'open'); // back to started
    await setStatus(alice, other.id, 'open'); // manual pause: started -> open
    await alice.post(`/api/tasks/${task.id}/reschedule${q}`, { date: TOMORROW });
    await alice.post(`/api/tasks/${task.id}/dismiss${q}`);
    await alice.patch(`/api/tasks/${task.id}${q}`, { status: 'open' }); // dismissed -> open

    assert.deepEqual(await events(), [
      ['task_created', task.id],
      ['task_created', other.id],
      ['task_started', task.id],
      ['task_paused', task.id],
      ['task_started', other.id],
      ['task_completed', other.id],
      ['task_reopened', other.id],
      ['task_paused', other.id],
      ['task_rescheduled', task.id],
      ['task_dismissed', task.id],
      ['task_reopened', task.id],
    ]);
    const rows = await all(api.db, 'SELECT * FROM task_events');
    for (const e of rows) {
      assert.equal(e.ownerId, ALICE);
      assert.equal(e.localDate, TODAY);
      assert.match(e.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  test('events never contain task text', async () => {
    const task = await createTask(alice);
    await start(alice, task.id);
    await setStatus(alice, task.id, 'completed');
    await alice.patch(`/api/tasks/${task.id}${q}`, { title: 'Another secret', notes: 'More secret notes' });

    const cols = (await all(api.db, 'PRAGMA table_info(task_events)')).map((c) => c.name);
    assert.deepEqual(cols, ['id', 'ownerId', 'taskId', 'type', 'occurredAt', 'localDate']);
    const dump = JSON.stringify(await all(api.db, 'SELECT * FROM task_events'));
    for (const text of [SECRET_TITLE, SECRET_NOTES, 'Another secret', 'More secret notes', 'secret']) {
      assert.ok(!dump.toLowerCase().includes(text.toLowerCase()), `"${text}" is not in the event log`);
    }
  });

  test('editing fields without changing status or date writes no event', async () => {
    const task = await createTask(alice);
    await alice.patch(`/api/tasks/${task.id}${q}`, { title: 'New', priority: 'high' });
    assert.deepEqual(await events(), [['task_created', task.id]]);
  });

  test('reschedule or dismiss of a started task logs only that action (no task_paused)', async () => {
    const a = await createTask(alice);
    const b = await createTask(alice);
    await start(alice, a.id);
    await alice.post(`/api/tasks/${a.id}/reschedule${q}`, { date: TOMORROW });
    await start(alice, b.id);
    await alice.post(`/api/tasks/${b.id}/dismiss${q}`);
    assert.deepEqual(await events({ types: ['task_paused', 'task_rescheduled', 'task_dismissed'] }), [
      ['task_rescheduled', a.id],
      ['task_dismissed', b.id],
    ]);
  });

  test('a failed action writes no event (same transaction)', async () => {
    const task = await createTask(alice);
    await setStatus(alice, task.id, 'completed');
    await start(alice, task.id); // 409
    await alice.patch(`/api/tasks/${task.id}${q}`, { endTime: '10:00' }); // 400: no start time
    assert.deepEqual(await events(), [['task_created', task.id], ['task_completed', task.id]]);
  });

  test('a task event that cannot be stored rolls back the change it describes', async () => {
    const task = await createTask(alice);
    const repo = createTaskRepository(api.db);
    await assert.rejects(repo.start(ALICE, task.id, { localDate: 'not-a-date' }));
    assert.equal(await statusOf(task.id), 'open');
    assert.deepEqual(await events({ types: ['task_started'] }), []);
  });

  test('a device date that is not plausible falls back to the server date for task events', async () => {
    const res = await alice.post('/api/tasks?today=2001-01-01', { title: 'x', category: 'Study' });
    assert.equal(res.status, 201);
    const { localDate } = await one(api.db, 'SELECT localDate FROM task_events');
    assert.ok(isPlausibleLocalDate(localDate));
  });

  test('seeding sample tasks writes no events', async () => {
    const { seedSampleTasks } = await import('../src/db/seed.js');
    await seedSampleTasks(api.db, ALICE, TODAY);
    assert.deepEqual(await events(), []);
  });
});

describe('app_opened (the only event a client may send)', () => {
  const opened = (user, body) => user.post('/api/events', body);

  test('is stored once per user per day', async () => {
    const first = await opened(alice, { type: 'app_opened', date: TODAY });
    assert.deepEqual([first.status, first.body], [201, { recorded: true }]);
    const second = await opened(alice, { type: 'app_opened', date: TODAY });
    assert.deepEqual([second.status, second.body], [200, { recorded: false }]);

    const rows = await all(api.db, 'SELECT * FROM task_events');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'app_opened');
    assert.equal(rows[0].ownerId, ALICE);
    assert.equal(rows[0].taskId, null);
    assert.equal(rows[0].localDate, TODAY);
  });

  test('a new day and another user each get their own app_opened', async () => {
    await opened(alice, { type: 'app_opened', date: TODAY });
    assert.equal((await opened(alice, { type: 'app_opened', date: TOMORROW })).status, 201);
    assert.equal((await opened(bob, { type: 'app_opened', date: TODAY })).status, 201);
    assert.equal((await one(api.db, 'SELECT COUNT(*) AS n FROM task_events')).n, 3);
  });

  test('concurrent calls on the same day still store only one', async () => {
    await Promise.all(Array.from({ length: 5 }, () => opened(alice, { type: 'app_opened', date: TODAY })));
    assert.equal((await one(api.db, 'SELECT COUNT(*) AS n FROM task_events')).n, 1);
  });

  for (const type of ['task_started', 'task_completed', 'task_created', 'something_else', undefined]) {
    test(`type ${JSON.stringify(type)} from the client is rejected`, async () => {
      const res = await opened(alice, { type, date: TODAY, taskId: 1 });
      assert.equal(res.status, 400);
      assert.ok(res.body.details.type);
      assert.equal((await one(api.db, 'SELECT COUNT(*) AS n FROM task_events')).n, 0);
    });
  }

  for (const date of [undefined, '', '2026-02-30', 'today', '2001-01-01', addDays(TODAY, 3)]) {
    test(`date ${JSON.stringify(date)} is rejected`, async () => {
      const res = await opened(alice, { type: 'app_opened', date });
      assert.equal(res.status, 400);
      assert.ok(res.body.details.date);
    });
  }

  test('an ownerId in the body is ignored', async () => {
    await opened(alice, { type: 'app_opened', date: TODAY, ownerId: BOB });
    assert.equal((await one(api.db, 'SELECT ownerId FROM task_events')).ownerId, ALICE);
  });
});

describe('ownership', () => {
  test("Bob cannot start Alice's task: 404, nothing changes, no event", async () => {
    const aliceTask = await createTask(alice);
    const bobTask = await createTask(bob);
    await start(bob, bobTask.id);
    const eventsBefore = await events();

    const res = await start(bob, aliceTask.id);
    assert.deepEqual([res.status, res.body], [404, { error: 'Task not found' }]);
    assert.equal(await statusOf(aliceTask.id), 'open');
    assert.equal(await statusOf(bobTask.id), 'started', "Bob's own started task is not paused");
    assert.deepEqual(await events(), eventsBefore);
  });

  test("Alice starting her task never pauses Bob's", async () => {
    const bobTask = await createTask(bob);
    await start(bob, bobTask.id);
    const aliceTask = await createTask(alice);
    await start(alice, aliceTask.id);
    assert.equal(await statusOf(bobTask.id), 'started');
    assert.deepEqual(await events({ ownerId: BOB, types: ['task_paused'] }), []);
  });

  test("Bob's actions on Alice's task (complete, untick, reschedule, dismiss) write no event", async () => {
    const aliceTask = await createTask(alice);
    await start(alice, aliceTask.id);
    const eventsBefore = await events();
    assert.equal((await setStatus(bob, aliceTask.id, 'completed')).status, 404);
    assert.equal((await setStatus(bob, aliceTask.id, 'open')).status, 404);
    assert.equal((await bob.post(`/api/tasks/${aliceTask.id}/reschedule${q}`, { date: TOMORROW })).status, 404);
    assert.equal((await bob.post(`/api/tasks/${aliceTask.id}/dismiss${q}`)).status, 404);
    assert.deepEqual(await events(), eventsBefore);
    assert.equal(await statusOf(aliceTask.id), 'started');
  });

  test('no API route returns events', async () => {
    await createTask(alice);
    for (const path of ['/api/events', '/api/events?ownerId=user_alice', '/api/task_events']) {
      const res = await bob.get(path);
      assert.equal(res.status, 404, path);
      assert.ok(!JSON.stringify(res.body).includes('task_created'));
    }
  });

  test("Bob does not see Alice's started task in his lists", async () => {
    const aliceTask = await createTask(alice);
    await start(alice, aliceTask.id);
    assert.deepEqual((await bob.get(`/api/tasks/today${q}`)).body.open, []);
    assert.deepEqual((await bob.get('/api/tasks?status=started')).body, []);
  });

  test('the repository refuses to start without an owner', async () => {
    const task = await createTask(alice);
    const repo = createTaskRepository(api.db);
    for (const owner of [undefined, null, '', '  ']) {
      await assert.rejects(repo.start(owner, task.id), /without an owner/);
    }
    assert.equal(await statusOf(task.id), 'open');
  });
});
