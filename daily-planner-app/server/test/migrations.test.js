// Migrations: fresh databases, upgrading a version-1 database with real data,
// idempotence, and refusing a database from a newer app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { MIGRATIONS, SCHEMA_VERSION, migrate, openDatabase } from '../src/db/connection.js';
import { startTestServer } from './helpers.js';

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
    assert.equal(SCHEMA_VERSION, 2);
    db.close();
  });

  test('running migrations again does nothing', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(migrate(db), []);
    db.close();
  });
});

describe('upgrading a version-1 database', () => {
  const file = path.join(tmpDir, 'v1.db');
  const before = createVersion1Database(file);
  const db = openDatabase(file);
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  after(() => db.close());

  test('ends at the latest version', () => {
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
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

  test('the API works on the upgraded data', async () => {
    const api = await startTestServer({ db: openDatabase(file) });
    try {
      const day = (await api.get('/api/tasks/today?today=2026-10-15')).body;
      assert.deepEqual(day.open.map((t) => t.title), ['Start only', 'Timed 90 min', 'Untimed']);
      assert.equal(day.completed[0].title, 'Two minutes');
      assert.equal(day.open[1].isFixed, false);
      const backlog = (await api.get('/api/tasks/backlog?today=2026-10-15')).body;
      assert.deepEqual(backlog.tasks.map((t) => t.title), ['Very long block']);
      const edited = await api.patch(`/api/tasks/${day.open[1].id}`, { priority: 'high', energy: 'deep' });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.notes, 'my notes');
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
