// Private tasks per signed-in account: two fake authenticated users, Alice and
// Bob. Neither can see or change the other's tasks, a foreign task looks
// exactly like a missing one, and an ownerId sent by the browser is ignored.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/connection.js';
import { resetWithSampleTasks, sampleTasks } from '../src/db/seed.js';
import { createTaskRepository } from '../src/db/taskRepository.js';
import { startTestServer } from './helpers.js';

const TODAY = '2026-10-15';
const YESTERDAY = '2026-10-14';
const ALICE = 'user_alice';
const BOB = 'user_bob';
const NOT_FOUND = { status: 404, body: { error: 'Task not found' } };

let api;
let alice;
let bob;
let aliceTask; // open, scheduled yesterday → in Alice's backlog
let bobTask;

before(async () => {
  api = await startTestServer();
  alice = api.asUser(ALICE);
  bob = api.asUser(BOB);
});
after(() => api.close());

beforeEach(async () => {
  api.db.exec('DELETE FROM tasks');
  aliceTask = (await alice.post(`/api/tasks?today=${TODAY}`, {
    title: 'Alice private task', category: 'Study', scheduledDate: YESTERDAY, notes: 'secret',
  })).body;
  bobTask = (await bob.post(`/api/tasks?today=${TODAY}`, {
    title: 'Bob private task', category: 'Gym', scheduledDate: YESTERDAY,
  })).body;
});

/** Alice's task straight from the database, including its owner. */
const aliceRow = () => api.db.prepare('SELECT * FROM tasks WHERE id = ?').get(aliceTask.id);
const reply = ({ status, body }) => ({ status, body });

describe("one user cannot touch another user's task", () => {
  const attempts = {
    read: () => bob.get(`/api/tasks/${aliceTask.id}`),
    edit: () => bob.patch(`/api/tasks/${aliceTask.id}`, { title: 'Hacked', notes: 'mine now' }),
    complete: () => bob.patch(`/api/tasks/${aliceTask.id}`, { status: 'completed' }),
    reschedule: () => bob.post(`/api/tasks/${aliceTask.id}/reschedule?today=${TODAY}`, { date: TODAY }),
    dismiss: () => bob.post(`/api/tasks/${aliceTask.id}/dismiss`),
    delete: () => bob.del(`/api/tasks/${aliceTask.id}`),
  };

  for (const [action, attempt] of Object.entries(attempts)) {
    test(`${action}: Bob gets 404 and Alice's task is unchanged`, async () => {
      const before = aliceRow();
      assert.deepEqual(reply(await attempt()), NOT_FOUND);
      assert.deepEqual(aliceRow(), before);
      assert.equal((await alice.get(`/api/tasks/${aliceTask.id}`)).status, 200);
    });
  }

  test("another user's task gets exactly the same response as a task that doesn't exist", async () => {
    const missing = 999999;
    const pairs = [
      [bob.get(`/api/tasks/${aliceTask.id}`), bob.get(`/api/tasks/${missing}`)],
      [bob.patch(`/api/tasks/${aliceTask.id}`, { title: 'x' }), bob.patch(`/api/tasks/${missing}`, { title: 'x' })],
      [bob.post(`/api/tasks/${aliceTask.id}/reschedule?today=${TODAY}`, { date: TODAY }),
        bob.post(`/api/tasks/${missing}/reschedule?today=${TODAY}`, { date: TODAY })],
      [bob.post(`/api/tasks/${aliceTask.id}/dismiss`), bob.post(`/api/tasks/${missing}/dismiss`)],
      [bob.del(`/api/tasks/${aliceTask.id}`), bob.del(`/api/tasks/${missing}`)],
    ];
    for (const [foreign, absent] of pairs) {
      assert.deepEqual(reply(await foreign), reply(await absent));
    }
  });

  test("a non-open foreign task still gets 404, not the 409 its owner would see", async () => {
    await alice.post(`/api/tasks/${aliceTask.id}/dismiss`);
    assert.deepEqual(reply(await bob.post(`/api/tasks/${aliceTask.id}/dismiss`)), NOT_FOUND);
    assert.deepEqual(
      reply(await bob.post(`/api/tasks/${aliceTask.id}/reschedule?today=${TODAY}`, { date: TODAY })),
      NOT_FOUND,
    );
    assert.equal((await alice.post(`/api/tasks/${aliceTask.id}/dismiss`)).status, 409);
  });
});

describe('lists show only your own tasks', () => {
  test('GET /api/tasks, with and without filters', async () => {
    const titles = async (user, query = '') => (await user.get(`/api/tasks${query}`)).body.map((t) => t.title);
    assert.deepEqual(await titles(alice), ['Alice private task']);
    assert.deepEqual(await titles(bob), ['Bob private task']);
    assert.deepEqual(await titles(bob, `?date=${YESTERDAY}&status=open`), ['Bob private task']);
    assert.deepEqual(await titles(bob, '?category=Study'), [], "Alice's Study task is not visible to Bob");
  });

  test('Today view', async () => {
    await alice.post(`/api/tasks?today=${TODAY}`, { title: 'Alice today', category: 'Career' });
    const day = (await bob.get(`/api/tasks/today?today=${TODAY}`)).body;
    assert.deepEqual(day, { date: TODAY, open: [], completed: [] });
    assert.deepEqual((await alice.get(`/api/tasks/today?today=${TODAY}`)).body.open.map((t) => t.title), ['Alice today']);
  });

  test('Backlog view', async () => {
    const backlog = async (user) => (await user.get(`/api/tasks/backlog?today=${TODAY}`)).body.tasks.map((t) => t.title);
    assert.deepEqual(await backlog(alice), ['Alice private task']);
    assert.deepEqual(await backlog(bob), ['Bob private task']);
  });

  test('a new user starts with an empty task list', async () => {
    const carol = api.asUser('user_carol');
    assert.deepEqual((await carol.get('/api/tasks')).body, []);
    assert.deepEqual((await carol.get(`/api/tasks/backlog?today=${TODAY}`)).body.tasks, []);
  });
});

describe('the owner comes only from the verified session', () => {
  test('an ownerId in the create body is ignored', async () => {
    const created = await bob.post(`/api/tasks?today=${TODAY}`, { title: 'Planted', category: 'Personal', ownerId: ALICE });
    assert.equal(created.status, 201);
    assert.equal(api.db.prepare('SELECT ownerId FROM tasks WHERE id = ?').get(created.body.id).ownerId, BOB);
    assert.ok(!(await alice.get('/api/tasks')).body.some((t) => t.title === 'Planted'));
  });

  test('an ownerId in an edit cannot transfer a task', async () => {
    const res = await bob.patch(`/api/tasks/${bobTask.id}`, { ownerId: ALICE, title: 'Still Bob' });
    assert.equal(res.status, 200);
    assert.equal(api.db.prepare('SELECT ownerId FROM tasks WHERE id = ?').get(bobTask.id).ownerId, BOB);
    assert.equal((await alice.get(`/api/tasks/${bobTask.id}`)).status, 404);
  });

  test('an ownerId in the query string is ignored', async () => {
    const titles = (await bob.get(`/api/tasks?ownerId=${ALICE}`)).body.map((t) => t.title);
    assert.deepEqual(titles, ['Bob private task']);
  });

  test('responses never include ownerId', async () => {
    const responses = [
      (await alice.get(`/api/tasks/${aliceTask.id}`)).body,
      ...(await alice.get('/api/tasks')).body,
      ...(await alice.get(`/api/tasks/backlog?today=${TODAY}`)).body.tasks,
      (await alice.patch(`/api/tasks/${aliceTask.id}`, { notes: 'n' })).body,
    ];
    for (const task of responses) assert.ok(!('ownerId' in task));
  });
});

describe('your own tasks work as before', () => {
  test('read, edit, complete, reopen, reschedule, dismiss and delete', async () => {
    const id = aliceTask.id;
    assert.equal((await alice.get(`/api/tasks/${id}`)).body.title, 'Alice private task');

    const edited = await alice.patch(`/api/tasks/${id}`, { title: 'Renamed', priority: 'high' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.title, 'Renamed');

    const completed = await alice.patch(`/api/tasks/${id}`, { status: 'completed' });
    assert.equal(completed.body.status, 'completed');
    assert.ok(completed.body.completedAt);

    const reopened = await alice.patch(`/api/tasks/${id}`, { status: 'open' });
    assert.equal(reopened.body.completedAt, null);

    const moved = await alice.post(`/api/tasks/${id}/reschedule?today=${TODAY}`, { date: TODAY });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.scheduledDate, TODAY);

    const dismissed = await alice.post(`/api/tasks/${id}/dismiss`);
    assert.equal(dismissed.body.status, 'dismissed');

    assert.equal((await alice.del(`/api/tasks/${id}`)).status, 204);
    assert.deepEqual(reply(await alice.get(`/api/tasks/${id}`)), NOT_FOUND);
    assert.equal((await bob.get(`/api/tasks/${bobTask.id}`)).status, 200, "Bob's task is unaffected");
  });
});

describe('defence in depth', () => {
  test('task routes answer 401 if no user ID reached them', async () => {
    const db = openDatabase(':memory:');
    const server = createApp({ db, serveClient: false, auth: (req, res, next) => next() }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tasks`);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: 'Authentication required' });
    } finally {
      server.close();
      db.close();
    }
  });

  test('the repository refuses to run without an owner', () => {
    const repo = createTaskRepository(api.db);
    for (const owner of [undefined, null, '', '  ', 42]) {
      assert.throws(() => repo.list(owner), /without an owner/);
      assert.throws(() => repo.findById(owner, aliceTask.id), /without an owner/);
      assert.throws(() => repo.create(owner, { title: 'x', category: 'Study', scheduledDate: TODAY }), /without an owner/);
      assert.throws(() => repo.update(owner, aliceTask.id, { title: 'x' }), /without an owner/);
      assert.throws(() => repo.remove(owner, aliceTask.id), /without an owner/);
      assert.throws(() => repo.forDay(owner, TODAY), /without an owner/);
      assert.throws(() => repo.backlog(owner, TODAY), /without an owner/);
    }
  });
});

describe('sample data', () => {
  test("seeding one user replaces only that user's tasks", () => {
    const count = (owner) => api.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE ownerId = ?').get(owner).n;
    resetWithSampleTasks(api.db, ALICE, TODAY);
    resetWithSampleTasks(api.db, ALICE, TODAY); // re-running replaces, not duplicates
    assert.equal(count(ALICE), sampleTasks(TODAY).length);
    assert.equal(count(BOB), 1);
    assert.ok(api.db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(bobTask.id));
  });

  test('seeding without an owner deletes nothing', () => {
    assert.throws(() => resetWithSampleTasks(api.db, '', TODAY));
    assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 2);
  });
});
