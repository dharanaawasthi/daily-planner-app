// Read-only north-star metrics from the event log. Prints numbers only:
// never task text, and with no owner given, no user IDs either.
//   npm run metrics -- [<clerk_user_id>] [--db <file>]
// Without --db it reads the database in TURSO_DATABASE_URL (server/.env).
// It never migrates or writes: only SELECT statements are run.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Middle value of a list of numbers (mean of the two middle ones if even), or null. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ratio = (part, whole) => (whole ? part / whole : null);

/**
 * Compute the metrics for one owner, or pooled over every user when
 * `ownerId` is omitted (a "day" is one user's local day, so all users' days
 * are counted together).
 *
 *  1. openedDaysWithStart: share of app_opened days that also have a task_started
 *  2. medianMinutesToFirstStart: median minutes from app_opened to that day's
 *     first task_started (days where the first start came before app_opened
 *     are left out)
 *  3. startedTasksCompleted: share of started tasks completed after their first start
 *  4. eventCounts: count of each event type in the last 7 and 30 days
 */
export async function computeMetrics(db, { ownerId, now = new Date() } = {}) {
  const result = await db.execute({
    sql: `SELECT ownerId, taskId, type, occurredAt, localDate FROM task_events
           ${ownerId === undefined ? '' : 'WHERE ownerId = ?'}
           ORDER BY occurredAt, id`,
    args: ownerId === undefined ? [] : [ownerId],
  });
  const rows = result.rows.map((r) => ({
    ownerId: r.ownerId, taskId: r.taskId, type: r.type, occurredAt: r.occurredAt, localDate: r.localDate,
  }));

  // 1 + 2: per user-day
  const openedAt = new Map(); // "owner|day" -> occurredAt of app_opened
  const firstStartAt = new Map(); // "owner|day" -> occurredAt of the first task_started
  for (const e of rows) {
    const day = `${e.ownerId}|${e.localDate}`;
    if (e.type === 'app_opened' && !openedAt.has(day)) openedAt.set(day, e.occurredAt);
    if (e.type === 'task_started' && !firstStartAt.has(day)) firstStartAt.set(day, e.occurredAt);
  }
  const openedDays = [...openedAt.keys()];
  const daysWithStart = openedDays.filter((day) => firstStartAt.has(day));
  const minutesToStart = daysWithStart
    .map((day) => (Date.parse(firstStartAt.get(day)) - Date.parse(openedAt.get(day))) / 60_000)
    .filter((m) => m >= 0);

  // 3: per task
  const firstStarted = new Map(); // "owner|task" -> occurredAt
  const completedAfterStart = new Set();
  for (const e of rows) {
    const task = `${e.ownerId}|${e.taskId}`;
    if (e.type === 'task_started' && !firstStarted.has(task)) firstStarted.set(task, e.occurredAt);
    if (e.type === 'task_completed' && firstStarted.has(task)) completedAfterStart.add(task);
  }

  // 4: counts per type
  const since = (days) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const countSince = (iso) => {
    const counts = Object.fromEntries(EVENT_TYPE_ORDER.map((t) => [t, 0]));
    for (const e of rows) if (e.occurredAt >= iso && e.occurredAt <= now.toISOString()) counts[e.type] += 1;
    return counts;
  };

  return {
    users: new Set(rows.map((e) => e.ownerId)).size,
    openedDays: openedDays.length,
    openedDaysWithStart: daysWithStart.length,
    openedDaysWithStartShare: ratio(daysWithStart.length, openedDays.length),
    medianMinutesToFirstStart: median(minutesToStart),
    startedTasks: firstStarted.size,
    startedTasksCompleted: completedAfterStart.size,
    startedTasksCompletedShare: ratio(completedAfterStart.size, firstStarted.size),
    eventCounts: { last7Days: countSince(since(7)), last30Days: countSince(since(30)) },
  };
}

// Same order as EVENT_TYPES in src/db/events.js (kept here so this script
// imports nothing that could open or migrate a database).
const EVENT_TYPE_ORDER = [
  'app_opened', 'task_created', 'task_started', 'task_paused',
  'task_completed', 'task_reopened', 'task_rescheduled', 'task_dismissed',
];

const pct = (share) => (share === null ? 'n/a' : `${(share * 100).toFixed(1)}%`);
const num = (n) => (n === null ? 'n/a' : n.toFixed(1));

/** The report as plain lines: numbers and fixed labels only. */
export function formatMetrics(m, { scope }) {
  const lines = [
    `Scope: ${scope}`,
    `Users with events: ${m.users}`,
    '',
    `1. Days with app_opened that also have a task_started: ${pct(m.openedDaysWithStartShare)} (${m.openedDaysWithStart} of ${m.openedDays} days)`,
    `2. Median minutes from app_opened to first task_started: ${num(m.medianMinutesToFirstStart)}`,
    `3. Started tasks later completed: ${pct(m.startedTasksCompletedShare)} (${m.startedTasksCompleted} of ${m.startedTasks} tasks)`,
    '4. Events                last 7 days   last 30 days',
  ];
  for (const type of EVENT_TYPE_ORDER) {
    lines.push(`   ${type.padEnd(20)} ${String(m.eventCounts.last7Days[type]).padStart(11)}   ${String(m.eventCounts.last30Days[type]).padStart(12)}`);
  }
  return lines.join('\n');
}

// ── Command line ─────────────────────────────────────────────────────────
function usage(message) {
  if (message) console.error(message);
  console.error('Usage: npm run metrics -- [<clerk_user_id>] [--db <file>]');
  console.error('Reads TURSO_DATABASE_URL from server/.env unless --db names a local database file.');
  process.exit(1);
}

async function main(argv) {
  let dbFile;
  let ownerId;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') dbFile = argv[++i] ?? usage('--db needs a file');
    else if (argv[i].startsWith('--')) usage(`Unknown option ${argv[i]}`);
    else if (ownerId === undefined) ownerId = argv[i].trim();
    else usage('Give at most one user ID');
  }

  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const url = dbFile ? `file:${path.resolve(dbFile)}` : process.env.TURSO_DATABASE_URL?.trim();
  if (!url) usage('No database: set TURSO_DATABASE_URL or pass --db <file>.');
  const db = createClient({ url, ...(dbFile ? {} : { authToken: process.env.TURSO_AUTH_TOKEN }) });

  try {
    const hasEvents = await db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_events'");
    if (!hasEvents.rows.length) usage('This database has no task_events table yet (it is older than version 4).');
    const metrics = await computeMetrics(db, { ownerId: ownerId || undefined });
    console.log(formatMetrics(metrics, { scope: ownerId ? 'one user' : 'all users (pooled user-days)' }));
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
