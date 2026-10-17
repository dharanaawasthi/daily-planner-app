// The read-only scripts: metrics on a small fixed event log with hand-worked
// answers, and backup of a local database file. Neither ever touches the
// hosted database: every test passes a temp file or an in-memory database.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createClient } from '@libsql/client';
import { backupDatabase } from '../scripts/backup.js';
import { computeMetrics, formatMetrics, median } from '../scripts/metrics.js';
import { openDatabase } from '../src/db/connection.js';

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-scripts-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const NOW = new Date('2026-10-16T12:00:00.000Z');
const A = 'user_metrics_a';
const B = 'user_metrics_b';

// [ownerId, taskId, type, occurredAt, localDate]
const FIXTURE = [
  // A, 14 Oct: opened 08:00, first start 08:10 (10 min). t1 completed after
  // its start; t2 "completed" before its start, so it doesn't count.
  [A, null, 'app_opened', '2026-10-14T08:00:00.000Z', '2026-10-14'],
  [A, 1, 'task_started', '2026-10-14T08:10:00.000Z', '2026-10-14'],
  [A, 2, 'task_completed', '2026-10-14T08:30:00.000Z', '2026-10-14'],
  [A, 2, 'task_started', '2026-10-14T08:40:00.000Z', '2026-10-14'],
  [A, 1, 'task_completed', '2026-10-14T09:00:00.000Z', '2026-10-14'],
  // A, 15 Oct: opened, nothing started.
  [A, null, 'app_opened', '2026-10-15T09:00:00.000Z', '2026-10-15'],
  [A, 3, 'task_created', '2026-10-15T09:05:00.000Z', '2026-10-15'],
  // A, 16 Oct: opened 07:00, first start 07:30 (30 min).
  [A, null, 'app_opened', '2026-10-16T07:00:00.000Z', '2026-10-16'],
  [A, 3, 'task_started', '2026-10-16T07:30:00.000Z', '2026-10-16'],
  // B, 1 Sep (older than 30 days): opened 10:00, start 10:05 (5 min).
  [B, null, 'app_opened', '2026-09-01T10:00:00.000Z', '2026-09-01'],
  [B, 11, 'task_started', '2026-09-01T10:05:00.000Z', '2026-09-01'],
  // B, 20 Sep (in the last 30 days, not the last 7).
  [B, 12, 'task_created', '2026-09-20T10:00:00.000Z', '2026-09-20'],
  // B, 15 Oct: a start with no app_opened that day (not in the day metrics).
  [B, 12, 'task_started', '2026-10-15T10:00:00.000Z', '2026-10-15'],
  // B, 16 Oct: opened 10:00, start 10:20 (20 min), completed.
  [B, null, 'app_opened', '2026-10-16T10:00:00.000Z', '2026-10-16'],
  [B, 10, 'task_started', '2026-10-16T10:20:00.000Z', '2026-10-16'],
  [B, 10, 'task_completed', '2026-10-16T11:00:00.000Z', '2026-10-16'],
];

const zeroCounts = {
  app_opened: 0, task_created: 0, task_started: 0, task_paused: 0,
  task_completed: 0, task_reopened: 0, task_rescheduled: 0, task_dismissed: 0,
};

async function fixtureDb(target = ':memory:') {
  const db = await openDatabase(target);
  await db.batch(
    FIXTURE.map((args) => ({
      sql: 'INSERT INTO task_events (ownerId, taskId, type, occurredAt, localDate) VALUES (?, ?, ?, ?, ?)',
      args,
    })),
    'write',
  );
  return db;
}

describe('metrics.js', () => {
  let db;
  before(async () => {
    db = await fixtureDb();
  });
  after(() => db.close());

  test('median', () => {
    assert.equal(median([]), null);
    assert.equal(median([7]), 7);
    assert.equal(median([30, 10, 20]), 20);
    assert.equal(median([10, 30, 20, 5]), 15);
  });

  test('one user (A)', async () => {
    const m = await computeMetrics(db, { ownerId: A, now: NOW });
    assert.equal(m.users, 1);
    assert.equal(m.openedDays, 3);
    assert.equal(m.openedDaysWithStart, 2);
    assert.equal(m.openedDaysWithStartShare, 2 / 3);
    assert.equal(m.medianMinutesToFirstStart, 20); // [10, 30]
    assert.equal(m.startedTasks, 3); // t1, t2, t3
    assert.equal(m.startedTasksCompleted, 1); // t1 only: t2's completion came before its start
    assert.deepEqual(m.eventCounts.last7Days, { ...zeroCounts, app_opened: 3, task_created: 1, task_started: 3, task_completed: 2 });
    assert.deepEqual(m.eventCounts.last30Days, m.eventCounts.last7Days);
  });

  test('one user (B)', async () => {
    const m = await computeMetrics(db, { ownerId: B, now: NOW });
    assert.equal(m.openedDays, 2);
    assert.equal(m.openedDaysWithStartShare, 1);
    assert.equal(m.medianMinutesToFirstStart, 12.5); // [5, 20]
    assert.equal(m.startedTasks, 3); // t10, t11, t12
    assert.equal(m.startedTasksCompleted, 1);
    assert.deepEqual(m.eventCounts.last7Days, { ...zeroCounts, app_opened: 1, task_started: 2, task_completed: 1 });
    assert.deepEqual(m.eventCounts.last30Days, { ...zeroCounts, app_opened: 1, task_created: 1, task_started: 2, task_completed: 1 });
  });

  test('all users: pooled user-days', async () => {
    const m = await computeMetrics(db, { now: NOW });
    assert.equal(m.users, 2);
    assert.equal(m.openedDays, 5);
    assert.equal(m.openedDaysWithStart, 4);
    assert.equal(m.openedDaysWithStartShare, 0.8);
    assert.equal(m.medianMinutesToFirstStart, 15); // [10, 30, 5, 20]
    assert.equal(m.startedTasks, 6);
    assert.equal(m.startedTasksCompleted, 2);
    assert.equal(m.startedTasksCompletedShare, 2 / 6);
    assert.deepEqual(m.eventCounts.last7Days, { ...zeroCounts, app_opened: 4, task_created: 1, task_started: 5, task_completed: 3 });
    assert.deepEqual(m.eventCounts.last30Days, { ...zeroCounts, app_opened: 4, task_created: 2, task_started: 5, task_completed: 3 });
  });

  test('an unknown user or an empty log gives n/a instead of dividing by zero', async () => {
    const m = await computeMetrics(db, { ownerId: 'user_nobody', now: NOW });
    assert.equal(m.openedDaysWithStartShare, null);
    assert.equal(m.medianMinutesToFirstStart, null);
    assert.equal(m.startedTasksCompletedShare, null);
    assert.match(formatMetrics(m, { scope: 'one user' }), /1\. .*: n\/a/);
  });

  test('the printed report has numbers and labels only, no user IDs', async () => {
    const text = formatMetrics(await computeMetrics(db, { now: NOW }), { scope: 'all users' });
    assert.match(text, /1\. .*80\.0% \(4 of 5 days\)/);
    assert.match(text, /2\. .*15\.0/);
    assert.match(text, /3\. .*33\.3% \(2 of 6 tasks\)/);
    assert.ok(!text.includes(A) && !text.includes(B));
  });

  test('the command line reads a local file and prints no IDs', async () => {
    const file = path.join(tmpDir, 'metrics.db');
    (await fixtureDb(file)).close();
    const before = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'metrics.js'), '--db', file], { encoding: 'utf8' });
    assert.match(out, /Scope: all users/);
    assert.match(out, /Users with events: 2/);
    assert.ok(!out.includes(A) && !out.includes(B));
    const afterHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(afterHash, before, 'the database file is unchanged');
  });
});

describe('backup.js', () => {
  test('writes every table and the schema version to a timestamped file, read-only', async () => {
    const file = path.join(tmpDir, 'backup-source.db');
    const db = await fixtureDb(file);
    await db.execute(`INSERT INTO tasks (ownerId, title, category, scheduledDate, createdAt, updatedAt)
                      VALUES ('${A}', 'Backed up', 'Study', '2026-10-16', 'now', 'now')`);
    db.close();
    const before = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

    const outDir = path.join(tmpDir, 'backups');
    const raw = createClient({ url: `file:${file}` });
    const result = await backupDatabase(raw, { outDir, source: 'test', now: NOW });
    raw.close();

    assert.equal(path.dirname(result.file), outDir);
    assert.equal(path.basename(result.file), 'todzy-backup-2026-10-16T12-00-00-000Z.json');
    assert.equal(result.schemaVersion, 4);
    assert.equal(result.counts.tasks, 1);
    assert.equal(result.counts.task_events, FIXTURE.length);
    assert.equal(result.counts.schema_migrations, 4);

    const json = JSON.parse(fs.readFileSync(result.file, 'utf8'));
    assert.equal(json.schemaVersion, 4);
    assert.equal(json.tables.tasks[0].title, 'Backed up');
    assert.equal(json.tables.task_events.length, FIXTURE.length);
    assert.equal(fs.statSync(result.file).mode & 0o777, 0o600, 'only the owner can read the backup');

    const afterHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(afterHash, before, 'the database file is unchanged');

    // Never overwrites an existing backup.
    const again = createClient({ url: `file:${file}` });
    await assert.rejects(backupDatabase(again, { outDir, source: 'test', now: NOW }), /EEXIST/);
    again.close();
  });

  test('the command line prints the row count of each table', async () => {
    const file = path.join(tmpDir, 'backup-cli.db');
    (await fixtureDb(file)).close();
    const outDir = path.join(tmpDir, 'cli-backups');
    const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'backup.js'), '--db', file, '--out', outDir], {
      encoding: 'utf8',
    });
    assert.match(out, /schema version 4/);
    assert.match(out, /task_events\s+16/);
    assert.match(out, /tasks\s+0/);
    assert.equal(fs.readdirSync(outDir).length, 1);
  });

  test('a --db file that does not exist exits with the usage message', () => {
    const res = spawnSync(process.execPath, [path.join(SCRIPTS, 'backup.js'), '--db', path.join(tmpDir, 'missing.db')], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Usage: npm run backup/);
  });
});
