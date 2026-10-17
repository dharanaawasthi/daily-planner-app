// Migrations: fresh databases, upgrading a version-1 database with real data
// (002), the deliberate reset of shared tasks (003), keeping every task while
// adding the started state and event log (004), databases from before
// schema_migrations existed (PRAGMA user_version), idempotence, refusing a
// database from a newer app, and choosing the hosted database in production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { createClient } from '@libsql/client';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  getSchemaVersion,
  migrate,
  openDatabase,
  resolveDatabaseUrl,
  splitSql,
} from '../src/db/connection.js';
import { TEST_USER_ID, all, one, startTestServer } from './helpers.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-migrations-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** A raw connection to a database file, with no migrations applied. */
const rawClient = (file) => createClient({ url: `file:${file}` });

const migration = (version) => MIGRATIONS.find((m) => m.version === version);

/** Run one migration's SQL the way the app does, plus its version record. */
async function applyMigration(db, version) {
  await db.batch(
    [
      ...splitSql(migration(version).sql),
      { sql: 'INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)', args: [version, 'test'] },
    ],
    'write',
  );
}

const SAMPLE_V1_ROWS = [
  ['Timed 90 min', 'Study', '2026-10-15', '09:00', '10:30', 'my notes', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z'],
  ['Untimed', 'Personal', '2026-10-15', null, null, '', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z'],
  ['Start only', 'Gym', '2026-10-15', '07:00', null, '', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z'],
  ['Very long block', 'Career', '2026-10-14', '07:00', '17:00', '', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z'],
  ['Two minutes', 'Study', '2026-10-15', '12:00', '12:02', '', 'completed', '2026-10-15T12:05:00.000Z', '2026-10-01T08:00:00.000Z', '2026-10-15T12:05:00.000Z'],
];

const INSERT_V1 = `INSERT INTO tasks (title, category, scheduledDate, startTime, endTime, notes, status, completedAt, createdAt, updatedAt)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Build a database exactly as the previous app (better-sqlite3) left it at
 * version 1: tasks with real data, version stored in PRAGMA user_version,
 * no schema_migrations table.
 */
async function createLegacyVersion1Database(file) {
  const db = rawClient(file);
  await db.batch(
    [
      ...splitSql(migration(1).sql),
      ...SAMPLE_V1_ROWS.map((args) => ({ sql: INSERT_V1, args })),
      'PRAGMA user_version = 1',
    ],
    'write',
  );
  const before = await all(db, 'SELECT * FROM tasks ORDER BY id');
  db.close();
  return before;
}

describe('fresh database', () => {
  test('is created at the latest version with every migration applied', async () => {
    const db = await openDatabase(':memory:');
    assert.equal(await getSchemaVersion(db), SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 4);
    const versions = (await all(db, 'SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version);
    assert.deepEqual(versions, [1, 2, 3, 4]);
    db.close();
  });

  test('running migrations again does nothing', async () => {
    const db = await openDatabase(':memory:');
    assert.deepEqual(await migrate(db), []);
    db.close();
  });

  test('a database file keeps its tasks across restarts', async () => {
    const file = path.join(tmpDir, 'restart.db');
    const first = await openDatabase(file);
    await first.execute({
      sql: `INSERT INTO tasks (ownerId, title, category, scheduledDate, createdAt, updatedAt)
            VALUES (?, 'Survives', 'Study', '2026-10-15', 'now', 'now')`,
      args: [TEST_USER_ID],
    });
    first.close();

    const second = await openDatabase(file);
    assert.deepEqual(await migrate(second), []);
    assert.equal((await one(second, 'SELECT title FROM tasks')).title, 'Survives');
    second.close();
  });
});

describe('splitting migration files into statements', () => {
  test('drops comments and keeps every statement', () => {
    const statements = splitSql(`-- a comment; with a semicolon
CREATE TABLE t (
  -- inside a table
  x INTEGER
);

CREATE INDEX i ON t (x);
`);
    assert.deepEqual(statements, ['CREATE TABLE t (\n  x INTEGER\n)', 'CREATE INDEX i ON t (x)']);
  });

  test('every migration file splits into statements', () => {
    for (const m of MIGRATIONS) assert.ok(splitSql(m.sql).length > 0, m.file);
  });
});

describe('migration 002 on a version-1 database', () => {
  const file = path.join(tmpDir, 'v1-to-v2.db');
  let before;
  let rows;

  test('upgrades to version 2', async () => {
    before = await createLegacyVersion1Database(file);
    const db = rawClient(file);
    assert.equal(await getSchemaVersion(db), 1, 'version 1 is read from PRAGMA user_version');
    await applyMigration(db, 2);
    assert.equal(await getSchemaVersion(db), 2);
    rows = await all(db, 'SELECT * FROM tasks ORDER BY id');
    db.close();
  });

  test('keeps every existing row and value, including timestamps', () => {
    assert.equal(rows.length, before.length);
    for (const [i, old] of before.entries()) {
      for (const [k, v] of Object.entries(old)) assert.deepEqual(rows[i][k], v, `${old.title}.${k}`);
    }
  });

  test('backfills duration from existing time blocks (clamped to 5–480)', () => {
    const duration = Object.fromEntries(rows.map((r) => [r.title, r.durationMinutes]));
    assert.deepEqual(duration, {
      'Timed 90 min': 90,
      Untimed: 60, // no block -> default
      'Start only': 60, // no end -> default
      'Very long block': 480, // 600 min clamped
      'Two minutes': 5, // 2 min clamped
    });
  });

  test('gives existing rows safe planning defaults', () => {
    for (const r of rows) {
      assert.equal(r.priority, 'medium');
      assert.equal(r.dueDate, null);
      assert.equal(r.isFixed, 0);
      assert.equal(r.energy, null, 'energy stays "not set" for old tasks');
    }
  });
});

describe('databases from the previous app version (PRAGMA user_version)', () => {
  test('a version-3 database keeps its tasks and is not reset again by 003', async () => {
    const file = path.join(tmpDir, 'legacy-v3.db');
    const db = rawClient(file);
    await db.batch(
      [
        ...splitSql(migration(3).sql),
        {
          sql: `INSERT INTO tasks (ownerId, title, category, scheduledDate, createdAt, updatedAt)
                VALUES (?, 'Kept', 'Career', '2026-10-15', 'now', 'now')`,
          args: [TEST_USER_ID],
        },
        'PRAGMA user_version = 3',
      ],
      'write',
    );
    db.close();

    const opened = await openDatabase(file);
    try {
      assert.equal(await getSchemaVersion(opened), SCHEMA_VERSION, 'only the newer migrations ran');
      assert.deepEqual((await all(opened, 'SELECT title FROM tasks')).map((r) => r.title), ['Kept']);
    } finally {
      opened.close();
    }
  });
});

describe('migration 003: private tasks (resets the old shared tasks)', () => {
  for (const fromVersion of [1, 2]) {
    test(`upgrading a version-${fromVersion} database with tasks ends at the latest version with no tasks`, async () => {
      const file = path.join(tmpDir, `v${fromVersion}-to-latest.db`);
      await createLegacyVersion1Database(file);
      if (fromVersion === 2) {
        const db = rawClient(file);
        await getSchemaVersion(db); // creates schema_migrations from user_version
        await applyMigration(db, 2);
        db.close();
      }

      const db = await openDatabase(file);
      try {
        assert.equal(await getSchemaVersion(db), SCHEMA_VERSION);
        assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM tasks')).n, 0, 'shared tasks are deleted');
        const owner = (await all(db, 'PRAGMA table_info(tasks)')).find((c) => c.name === 'ownerId');
        assert.ok(owner, 'tasks has an ownerId column');
        assert.equal(owner.notnull, 1);
      } finally {
        db.close();
      }
    });
  }

  test('the database rejects a task without an owner', async () => {
    const db = await openDatabase(':memory:');
    const insert = (ownerId) =>
      db.execute({
        sql: `INSERT INTO tasks (ownerId, title, category, scheduledDate, createdAt, updatedAt)
              VALUES (?, 'x', 'Study', '2026-10-15', 'now', 'now')`,
        args: [ownerId],
      });
    await assert.rejects(insert(null));
    await assert.rejects(insert(''));
    await assert.rejects(insert('   '));
    await assert.doesNotReject(insert('user_a'));
    db.close();
  });

  test('the API works after the reset: ids restart at 1 and new tasks belong to their creator', async () => {
    const file = path.join(tmpDir, 'reset-api.db');
    await createLegacyVersion1Database(file);
    const api = await startTestServer({ db: await openDatabase(file) });
    try {
      assert.deepEqual((await api.get('/api/tasks')).body, []);
      const created = await api.post('/api/tasks?today=2026-10-15', { title: 'Fresh start', category: 'Study' });
      assert.equal(created.status, 201);
      assert.equal(created.body.id, 1);
      assert.equal((await one(api.db, 'SELECT ownerId FROM tasks WHERE id = 1')).ownerId, TEST_USER_ID);
    } finally {
      api.close();
    }
  });
});

describe('migration 004 on a version-3 database with tasks', () => {
  const V3_ROWS = [
    // ownerId, title, scheduledDate, startTime, endTime, notes, status, completedAt, createdAt, updatedAt, duration, priority, dueDate, isFixed, energy
    ['user_a', 'Open timed', '2026-10-15', '09:00', '10:30', 'private notes', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z', 90, 'high', '2026-10-20', 1, 'deep'],
    ['user_a', 'Done', '2026-10-15', null, null, '', 'completed', '2026-10-15T12:05:00.000Z', '2026-10-01T08:00:00.000Z', '2026-10-15T12:05:00.000Z', 60, 'medium', null, 0, null],
    ['user_b', 'Dropped', '2026-10-10', null, null, 'n', 'dismissed', null, '2026-10-01T08:00:00.000Z', '2026-10-03T08:00:00.000Z', 30, 'low', null, 0, 'light'],
    ['user_b', 'Deleted later', '2026-10-11', null, null, '', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z', 60, 'medium', null, 0, 'normal'],
  ];
  const INSERT_V3 = `INSERT INTO tasks (ownerId, title, scheduledDate, startTime, endTime, notes, status, completedAt,
                                        createdAt, updatedAt, durationMinutes, priority, dueDate, isFixed, energy, category)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Study')`;

  /** A database at version 3 (schema_migrations 1–3) with tasks; the last one deleted. */
  async function createVersion3Database(file) {
    const db = rawClient(file);
    await getSchemaVersion(db); // creates schema_migrations
    for (const v of [1, 2, 3]) await applyMigration(db, v);
    await db.batch(V3_ROWS.map((args) => ({ sql: INSERT_V3, args })), 'write');
    await db.execute("DELETE FROM tasks WHERE title = 'Deleted later'");
    const before = await all(db, 'SELECT * FROM tasks ORDER BY id');
    db.close();
    return before;
  }

  const file = path.join(tmpDir, 'v3-to-v4.db');
  let before;
  let db;
  after(() => db?.close());

  test('upgrades from version 3 to 4', async () => {
    before = await createVersion3Database(file);
    assert.equal(before.length, 3);
    db = await openDatabase(file);
    assert.equal(await getSchemaVersion(db), 4);
  });

  test('keeps every task with every value unchanged, and startedAt is null', async () => {
    const rows = await all(db, 'SELECT * FROM tasks ORDER BY id');
    assert.equal(rows.length, before.length);
    for (const [i, old] of before.entries()) {
      for (const [k, v] of Object.entries(old)) assert.deepEqual(rows[i][k], v, `${old.title}.${k}`);
      assert.equal(rows[i].startedAt, null);
    }
  });

  test('the id of a deleted task is not reused', async () => {
    const { lastInsertRowid } = await db.execute(
      `INSERT INTO tasks (ownerId, title, category, scheduledDate, createdAt, updatedAt)
       VALUES ('user_a', 'New', 'Gym', '2026-10-16', 'now', 'now')`,
    );
    assert.equal(Number(lastInsertRowid), 5, 'ids 1–4 were used before the upgrade');
  });

  test('keeps the indexes and adds the started-task and event indexes', async () => {
    const names = (await all(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")).map((r) => r.name);
    assert.deepEqual(names.sort(), [
      'idx_task_events_app_opened_per_day',
      'idx_task_events_owner_time',
      'idx_tasks_one_started_per_owner',
      'idx_tasks_owner_date_status',
      'idx_tasks_owner_due_date',
      'idx_tasks_owner_status_date',
    ]);
  });

  test('creates an empty task_events table with no free-text columns', async () => {
    const cols = (await all(db, 'PRAGMA table_info(task_events)')).map((c) => c.name);
    assert.deepEqual(cols, ['id', 'ownerId', 'taskId', 'type', 'occurredAt', 'localDate']);
    assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM task_events')).n, 0);
  });

  test('the database enforces the started rules itself', async () => {
    const insert = (status, startedAt, ownerId = 'user_c') =>
      db.execute({
        sql: `INSERT INTO tasks (ownerId, title, category, scheduledDate, status, startedAt, createdAt, updatedAt)
              VALUES (?, 'x', 'Study', '2026-10-16', ?, ?, 'now', 'now')`,
        args: [ownerId, status, startedAt],
      });
    await assert.rejects(insert('started', null), 'started needs startedAt');
    await assert.doesNotReject(insert('started', '2026-10-16T09:00:00.000Z'));
    await assert.rejects(insert('started', '2026-10-16T09:05:00.000Z'), 'only one started task per owner');
    await assert.doesNotReject(insert('started', '2026-10-16T09:05:00.000Z', 'user_d'), 'other owners are independent');
    await assert.doesNotReject(insert('open', '2026-10-16T09:00:00.000Z'), 'a paused task keeps its startedAt');
  });

  test('a failing 004 leaves the database at version 3 with its tasks', async () => {
    const broken = path.join(tmpDir, 'v3-broken.db');
    const kept = await createVersion3Database(broken);
    const raw = rawClient(broken);
    // Make 004 fail AFTER it has dropped and renamed tasks: task_events exists.
    await raw.execute('CREATE TABLE task_events (x INTEGER)');
    await assert.rejects(migrate(raw));
    assert.equal(await getSchemaVersion(raw), 3);
    assert.deepEqual(await all(raw, 'SELECT * FROM tasks ORDER BY id'), kept);
    const cols = (await all(raw, 'PRAGMA table_info(tasks)')).map((c) => c.name);
    assert.ok(!cols.includes('startedAt'), 'the rebuild was rolled back');
    raw.close();
  });
});

describe('safety', () => {
  test('refuses a database created by a newer version of the app', async () => {
    const file = path.join(tmpDir, 'future.db');
    const db = rawClient(file);
    await db.execute('PRAGMA user_version = 99');
    db.close();
    await assert.rejects(openDatabase(file), /version 99/);
  });

  test('a failing migration leaves the database at its previous version', async () => {
    const file = path.join(tmpDir, 'broken.db');
    await createLegacyVersion1Database(file);
    const db = rawClient(file);
    // Make migration 002 fail part-way: the column it adds already exists.
    await db.execute('ALTER TABLE tasks ADD COLUMN energy TEXT');

    await assert.rejects(migrate(db));
    assert.equal(await getSchemaVersion(db), 1);
    const cols = (await all(db, 'PRAGMA table_info(tasks)')).map((c) => c.name);
    assert.ok(!cols.includes('durationMinutes'), 'earlier statements in the failed migration were rolled back');
    db.close();
  });
});

describe('choosing the database', () => {
  test('uses Turso when TURSO_DATABASE_URL is set', () => {
    assert.equal(
      resolveDatabaseUrl({ TURSO_DATABASE_URL: 'libsql://planner-me.turso.io', RENDER: 'true' }),
      'libsql://planner-me.turso.io',
    );
  });

  test('uses a local file in development', () => {
    const file = path.join(tmpDir, 'dev', 'planner.db');
    assert.equal(resolveDatabaseUrl({ DB_PATH: file }), `file:${file}`);
  });

  test('refuses to start on Render without Turso, instead of silently losing data', () => {
    assert.throws(() => resolveDatabaseUrl({ RENDER: 'true' }), /TURSO_DATABASE_URL is not set/);
    assert.throws(() => resolveDatabaseUrl({ RENDER: 'true', TURSO_DATABASE_URL: '' }), /TURSO_DATABASE_URL is not set/);
  });
});
