// End-to-end API tests on an in-memory database seeded with the sample tasks.
// Run with: npm test
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/connection.js';
import { resetWithSampleTasks } from '../src/db/seed.js';
import { testAuth } from './helpers.js';

const TODAY = '2026-10-15';

let db;
let server;
let base;

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);
const del = (p) => call('DELETE', p);

const titles = (tasks) => tasks.map((t) => t.title);
const backlogTitles = async (today = TODAY) => titles((await get(`/api/tasks/backlog?today=${today}`)).body.tasks);
const findByTitle = async (title) =>
  (await get('/api/tasks')).body.find((t) => t.title === title);

before(async () => {
  db = openDatabase(':memory:');
  server = createApp({ db, serveClient: false, auth: testAuth }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

beforeEach(() => {
  resetWithSampleTasks(db, TODAY);
});

describe('schema', () => {
  test('tasks table has exactly the data-model columns', () => {
    const cols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    assert.deepEqual(cols, [
      'id', 'title', 'category', 'scheduledDate', 'startTime', 'endTime',
      'notes', 'status', 'completedAt', 'createdAt', 'updatedAt',
      // added by migration 002
      'durationMinutes', 'priority', 'dueDate', 'isFixed', 'energy',
    ]);
  });

  test('database rejects a "backlog" status — backlog is derived, not stored', () => {
    assert.throws(() =>
      db.prepare(`INSERT INTO tasks (title, category, scheduledDate, status, createdAt, updatedAt)
                  VALUES ('x', 'Study', '2026-10-01', 'backlog', 'now', 'now')`).run(),
    );
  });

  test('database keeps completedAt consistent with status', () => {
    const insert = (status, completedAt) =>
      db.prepare(`INSERT INTO tasks (title, category, scheduledDate, status, completedAt, createdAt, updatedAt)
                  VALUES ('x', 'Study', '2026-10-01', ?, ?, 'now', 'now')`).run(status, completedAt);

    assert.throws(() => insert('completed', null)); // completed needs a timestamp
    assert.throws(() => insert('open', 'now')); // open must not have one
    assert.throws(() => insert('dismissed', 'now')); // nor dismissed
    assert.doesNotThrow(() => insert('completed', 'now'));
    assert.doesNotThrow(() => insert('dismissed', null));
  });
});

describe('GET /api/tasks/today', () => {
  test('splits open and completed, each sorted by start time with untimed tasks last', async () => {
    const { status, body } = await get(`/api/tasks/today?today=${TODAY}`);
    assert.equal(status, 200);
    assert.equal(body.date, TODAY);

    assert.deepEqual(titles(body.open), [
      'Review linear algebra lecture notes', // 09:00
      'Apply to two backend developer roles', // 11:00
      'Mock interview: system design', // 16:00
      'Upper body strength session', // 18:00
      'Read chapter 5 of Operating Systems', // anytime
      'Call Mom', // anytime
    ]);
    assert.deepEqual(titles(body.completed), ['Morning run + stretching', 'Lunch with Sara']);
    assert.ok(body.completed.every((t) => t.completedAt));
  });

  test('rejects a malformed ?today', async () => {
    assert.equal((await get('/api/tasks/today?today=2026-13-01')).status, 400);
  });
});

describe('GET /api/tasks/backlog', () => {
  test('returns open tasks before today, oldest first; excludes completed and dismissed', async () => {
    assert.deepEqual(await backlogTitles(), [
      'Mobility routine (hips + shoulders)', // -4
      'Update LinkedIn headline and summary', // -3
      'Finish problem set 3', // -1, 19:00
      'Pay the phone bill', // -1, untimed
    ]);
  });

  test('follows the client-supplied date: tomorrow, today\'s open tasks become backlog', async () => {
    const list = await backlogTitles('2026-10-16');
    assert.equal(list.length, 4 + 6);
    assert.ok(list.includes('Call Mom'));
    assert.ok(!list.includes('Lunch with Sara')); // completed stays out
  });
});

describe('POST /api/tasks', () => {
  test('creates a minimal task: date defaults to today, no time, status open', async () => {
    const { status, body } = await post(`/api/tasks?today=${TODAY}`, { title: '  Stretch  ', category: 'gym' });
    assert.equal(status, 201);
    assert.equal(body.title, 'Stretch');
    assert.equal(body.category, 'Gym');
    assert.equal(body.scheduledDate, TODAY);
    assert.equal(body.startTime, null);
    assert.equal(body.endTime, null);
    assert.equal(body.notes, '');
    assert.equal(body.status, 'open');
    assert.equal(body.completedAt, null);
    assert.ok(body.createdAt && body.updatedAt);
  });

  test('creates a fully specified task', async () => {
    const input = {
      title: 'Flashcards', category: 'Study', scheduledDate: '2026-10-20',
      startTime: '08:15', endTime: '08:45', notes: 'Spanish deck',
    };
    const { status, body } = await post('/api/tasks', input);
    assert.equal(status, 201);
    assert.deepEqual(
      { title: body.title, category: body.category, scheduledDate: body.scheduledDate, startTime: body.startTime, endTime: body.endTime, notes: body.notes },
      input,
    );
  });

  test('reports every invalid field at once', async () => {
    const { status, body } = await post('/api/tasks', {
      title: '', category: 'Cooking', scheduledDate: '2026-02-30', startTime: '25:00', status: 'backlog',
    });
    assert.equal(status, 400);
    assert.deepEqual(Object.keys(body.details).sort(), ['category', 'scheduledDate', 'startTime', 'status', 'title']);
  });

  test('requires end time to follow start time', async () => {
    const noStart = await post('/api/tasks', { title: 'x', category: 'Study', endTime: '10:00' });
    assert.equal(noStart.status, 400);
    assert.ok(noStart.body.details.endTime);

    const backwards = await post('/api/tasks', { title: 'x', category: 'Study', startTime: '10:00', endTime: '09:00' });
    assert.equal(backwards.status, 400);
  });

  test('rejects malformed JSON', async () => {
    const { status, body } = await post('/api/tasks', '{"title": ');
    assert.equal(status, 400);
    assert.match(body.error, /JSON/);
  });
});

describe('PATCH /api/tasks/:id', () => {
  test('edits fields and ignores read-only ones', async () => {
    const task = await findByTitle('Call Mom');
    const { status, body } = await patch(`/api/tasks/${task.id}`, {
      id: 999, createdAt: 'hacked', title: 'Call Mom and Dad', startTime: '20:00', endTime: '20:30', notes: 'Sunday plans',
    });
    assert.equal(status, 200);
    assert.equal(body.id, task.id);
    assert.equal(body.createdAt, task.createdAt);
    assert.equal(body.title, 'Call Mom and Dad');
    assert.equal(body.startTime, '20:00');
    assert.ok(body.updatedAt >= task.updatedAt);
  });

  test('checkbox: completing stamps completedAt and moves the task; reopening clears it', async () => {
    const task = await findByTitle('Review linear algebra lecture notes');

    const done = await patch(`/api/tasks/${task.id}`, { status: 'completed' });
    assert.equal(done.body.status, 'completed');
    assert.ok(done.body.completedAt);

    let day = (await get(`/api/tasks/today?today=${TODAY}`)).body;
    assert.ok(titles(day.completed).includes(task.title));
    assert.ok(!titles(day.open).includes(task.title));

    const reopened = await patch(`/api/tasks/${task.id}`, { status: 'open' });
    assert.equal(reopened.body.completedAt, null);
    day = (await get(`/api/tasks/today?today=${TODAY}`)).body;
    assert.equal(day.open[0].title, task.title); // back in 09:00 position
  });

  test('editing a completed task keeps its original completedAt', async () => {
    const task = await findByTitle('Lunch with Sara');
    const { body } = await patch(`/api/tasks/${task.id}`, { notes: 'Great tacos' });
    assert.equal(body.completedAt, task.completedAt);
  });

  test('clearing the start time also clears the end time', async () => {
    const task = await findByTitle('Mock interview: system design');
    const { status, body } = await patch(`/api/tasks/${task.id}`, { startTime: null });
    assert.equal(status, 200);
    assert.equal(body.startTime, null);
    assert.equal(body.endTime, null);
  });

  test('validates the merged task (new end time vs existing start time)', async () => {
    const task = await findByTitle('Mock interview: system design'); // 16:00–17:00
    assert.equal((await patch(`/api/tasks/${task.id}`, { endTime: '15:00' })).status, 400);
  });

  test('404 for unknown or non-numeric ids', async () => {
    assert.equal((await patch('/api/tasks/99999', { title: 'x' })).status, 404);
    assert.equal((await get('/api/tasks/abc')).status, 404);
  });
});

describe('backlog actions', () => {
  test('schedule for today moves a backlog task into Today, keeping its time', async () => {
    const task = await findByTitle('Finish problem set 3');
    const { status, body } = await post(`/api/tasks/${task.id}/reschedule?today=${TODAY}`, { date: TODAY });
    assert.equal(status, 200);
    assert.equal(body.scheduledDate, TODAY);
    assert.equal(body.startTime, '19:00');

    assert.ok(!(await backlogTitles()).includes(task.title));
    const day = (await get(`/api/tasks/today?today=${TODAY}`)).body;
    assert.ok(titles(day.open).includes(task.title));
  });

  test('choose another date (future) removes it from the backlog', async () => {
    const task = await findByTitle('Pay the phone bill');
    const { status } = await post(`/api/tasks/${task.id}/reschedule?today=${TODAY}`, { date: '2026-10-18' });
    assert.equal(status, 200);
    assert.ok(!(await backlogTitles()).includes(task.title));
  });

  test('cannot reschedule into the past, or reschedule a non-open task', async () => {
    const open = await findByTitle('Pay the phone bill');
    assert.equal((await post(`/api/tasks/${open.id}/reschedule?today=${TODAY}`, { date: '2026-10-01' })).status, 400);
    assert.equal((await post(`/api/tasks/${open.id}/reschedule?today=${TODAY}`, {})).status, 400);

    const done = await findByTitle('Leg day');
    assert.equal((await post(`/api/tasks/${done.id}/reschedule?today=${TODAY}`, { date: TODAY })).status, 409);
  });

  test('dismiss sets status=dismissed and removes it from the backlog', async () => {
    const task = await findByTitle('Update LinkedIn headline and summary');
    const { status, body } = await post(`/api/tasks/${task.id}/dismiss`);
    assert.equal(status, 200);
    assert.equal(body.status, 'dismissed');
    assert.ok(!(await backlogTitles()).includes(task.title));

    assert.equal((await post(`/api/tasks/${task.id}/dismiss`)).status, 409);
  });
});

describe('DELETE /api/tasks/:id', () => {
  test('deletes, then 404s', async () => {
    const task = await findByTitle('Call Mom');
    assert.equal((await del(`/api/tasks/${task.id}`)).status, 204);
    assert.equal((await get(`/api/tasks/${task.id}`)).status, 404);
    assert.equal((await del(`/api/tasks/${task.id}`)).status, 404);
  });
});

describe('GET /api/tasks filters', () => {
  test('filters by status and category', async () => {
    const { body } = await get('/api/tasks?status=dismissed');
    assert.deepEqual(titles(body), ['Reorganise bookshelf']);

    const gym = (await get('/api/tasks?category=gym&date=2026-10-15')).body;
    assert.deepEqual(titles(gym), ['Morning run + stretching', 'Upper body strength session']);
  });

  test('unknown API routes return JSON 404', async () => {
    const { status, body } = await get('/api/nope');
    assert.equal(status, 404);
    assert.ok(body.error);
  });
});
