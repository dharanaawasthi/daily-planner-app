// Migrations: fresh databases, upgrading a version-1 database with real data
// (002), the deliberate reset of shared tasks (003), idempotence, and refusing
// a database from a newer app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { MIGRATIONS, SCHEMA_VERSION, migrate, openDatabase } from '../src/db/connection.js';
import { TEST_USER_ID, startTestServer } from './helpers.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-migrations-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** Build a database exactly as the previous app version (v1) would have. */
function createVersion1Database(file) {
  const db = new Database(file);
  db.exec(MIGRATIONS.find((m) => m.version === 1).sql);
  db.pragma('user_version = 1');
  const insert = db.prepare(`INSERT INTO tasks (title, category, scheduledDate, startTime, endTime, notes, status, completedAt, createdAt, updatedAt)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run('Timed 90 min', 'Study', '2026-10-15', '09:00', '10:30', 'my notes', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z');
  insert.run('Untimed', 'Personal', '2026-10-15', null, null, '', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z');
  insert.run('Start only', 'Gym', '2026-10-15', '07:00', null, '', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z');
  insert.run('Very long block', 'Career', '2026-10-14', '07:00', '17:00', '', 'open', null, '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z');
  insert.run('Two minutes', 'Study', '2026-10-15', '12:00', '12:02', '', 'completed', '2026-10-15T12:05:00.000Z', '2026-10-01T08:00:00.000Z', '2026-10-15T12:05:00.000Z');
  const before = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  db.close();
  return before;
}

describe('fresh database', () => {
  test('is created at the latest version with every migration applied', () => {
    const db = openDatabase(':memory:');
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 3);
    db.close();
  });

  test('running migrations again does nothing', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(migrate(db), []);
    db.close();
  });
});

/** Apply migrations up to (and including) `version` only, as an older app would. */
function migrateTo(file, version) {
  const db = new Database(file);
  for (const m of MIGRATIONS) {
    if (m.version <= db.pragma('user_version', { simple: true }) || m.version > version) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return db;
}

describe('migration 002 on a version-1 database', () => {
  const file = path.join(tmpDir, 'v1-to-v2.db');
  const before = createVersion1Database(file);
  const db = migrateTo(file, 2);
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  after(() => db.close());

  test('ends at version 2', () => {
    assert.equal(db.pragma('user_version', { simple: true }), 2);
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

describe('migration 003: private tasks (resets the old shared tasks)', () => {
  for (const fromVersion of [1, 2]) {
    test(`upgrading a version-${fromVersion} database with tasks ends at the latest version with no tasks`, () => {
      const file = path.join(tmpDir, `v${fromVersion}-to-latest.db`);
      createVersion1Database(file);
      migrateTo(file, fromVersion).close();

      const db = openDatabase(file);
      try {
        assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 0, 'shared tasks are deleted');
        const owner = db.prepare('PRAGMA table_info(tasks)').all().find((c) => c.name === 'ownerId');
        assert.ok(owner, 'tasks has an ownerId column');
        assert.equal(owner.notnull, 1);
      } finally {
        db.close();
      }
    });
  }

  test('the database rejects a task without an owner', () => {
    const db = openDatabase(':memory:');
    const insert = (ownerId) =>
      db.prepare(`INSERT INTO tasks (ownerId, title, category, scheduledDate, createdAt, updatedAt)
                  VALUES (?, 'x', 'Study', '2026-10-15', 'now', 'now')`).run(ownerId);
    assert.throws(() => insert(null));
    assert.throws(() => insert(''));
    assert.throws(() => insert('   '));
    assert.doesNotThrow(() => insert('user_a'));
    db.close();
  });

  test('the API works after the reset: ids restart at 1 and new tasks belong to their creator', async () => {
    const file = path.join(tmpDir, 'reset-api.db');
    createVersion1Database(file);
    const api = await startTestServer({ db: openDatabase(file) });
    try {
      assert.deepEqual((await api.get('/api/tasks')).body, []);
      const created = await api.post('/api/tasks?today=2026-10-15', { title: 'Fresh start', category: 'Study' });
      assert.equal(created.status, 201);
      assert.equal(created.body.id, 1);
      assert.equal(api.db.prepare('SELECT ownerId FROM tasks WHERE id = 1').get().ownerId, TEST_USER_ID);
    } finally {
      api.close();
    }
  });
});

describe('safety', () => {
  test('refuses a database created by a newer version of the app', () => {
    const file = path.join(tmpDir, 'future.db');
    const db = new Database(file);
    db.pragma('user_version = 99');
    db.close();
    assert.throws(() => openDatabase(file), /version 99/);
  });

  test('a failing migration leaves the database at its previous version', () => {
    const file = path.join(tmpDir, 'broken.db');
    createVersion1Database(file);
    const db = new Database(file);
    // Make migration 002 fail part-way: the column it adds already exists.
    db.exec('ALTER TABLE tasks ADD COLUMN energy TEXT');
    db.close();

    const reopened = new Database(file);
    assert.throws(() => migrate(reopened));
    assert.equal(reopened.pragma('user_version', { simple: true }), 1);
    const cols = reopened.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    assert.ok(!cols.includes('durationMinutes'), 'earlier statements in the failed migration were rolled back');
    reopened.close();
  });
});
