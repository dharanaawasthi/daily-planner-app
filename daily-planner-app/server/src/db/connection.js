import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

export const DEFAULT_DB_PATH = path.resolve(here, '../../data/planner.db');

/**
 * Migrations are the numbered .sql files in ./migrations, applied in order.
 * The number in the file name is the database version it produces:
 *   001_initial.sql         -> version 1
 *   002_planning_fields.sql -> version 2
 * The schema_migrations table records which ones have run.
 */
export const MIGRATIONS = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort()
  .map((file) => ({
    version: Number(file.slice(0, 3)),
    file,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
  }));

export const SCHEMA_VERSION = MIGRATIONS.at(-1).version;

/**
 * Split a migration file into single statements (the database client runs
 * one statement per call). Comment lines are dropped first. Our migrations
 * contain no semicolons inside strings or triggers, so splitting on ";" is safe.
 */
export function splitSql(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Where the data lives:
 *  - TURSO_DATABASE_URL set (libsql://…): the hosted Turso database. Data
 *    survives restarts and redeploys — use this on Render.
 *  - otherwise: a local SQLite file (DB_PATH, default server/data/planner.db),
 *    for development on your own computer.
 */
export function resolveDatabaseUrl(env = process.env) {
  if (env.TURSO_DATABASE_URL) return env.TURSO_DATABASE_URL.trim();

  // Render's disk is wiped on every restart and redeploy, so a local file
  // there silently loses everyone's tasks. Refuse to start instead.
  if (env.RENDER) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. On Render the local disk is erased on every restart, ' +
        'so tasks would be lost. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Render → Environment.',
    );
  }
  return toUrl(env.DB_PATH || DEFAULT_DB_PATH);
}

/** ':memory:', a URL (file:, libsql:, https:) or a file path → client URL. */
function toUrl(target) {
  if (target === ':memory:' || /^[a-z][a-z0-9+.-]+:/i.test(target)) return target;
  const file = path.resolve(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return `file:${file}`;
}

/**
 * Connect to the database and bring the schema up to date.
 *   openDatabase()               → Turso if configured, else the local file
 *   openDatabase(':memory:')     → throwaway database (used by the tests)
 *   openDatabase('/tmp/x.db')    → a specific local file
 */
export async function openDatabase(target, { authToken = process.env.TURSO_AUTH_TOKEN } = {}) {
  const url = target === undefined ? resolveDatabaseUrl() : toUrl(target);
  const db = createClient({ url, ...(url.startsWith('file:') || url === ':memory:' ? {} : { authToken }) });
  try {
    await migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** First column of the first row, or undefined. */
function firstValue(result) {
  const row = result.rows[0];
  return row === undefined ? undefined : row[result.columns[0]];
}

/**
 * The version the database is at. Databases made before schema_migrations
 * existed stored it in SQLite's PRAGMA user_version; that is copied over once.
 */
export async function getSchemaVersion(db) {
  const hasTable = await db.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (hasTable.rows.length > 0) {
    return Number(firstValue(await db.execute('SELECT COALESCE(MAX(version), 0) FROM schema_migrations')));
  }

  let legacy = 0;
  try {
    legacy = Number(firstValue(await db.execute('PRAGMA user_version')) ?? 0);
  } catch {
    legacy = 0; // a host that doesn't support the pragma is a new database
  }

  const appliedAt = new Date().toISOString();
  const statements = [
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)',
  ];
  for (let version = 1; version <= legacy; version += 1) {
    statements.push({ sql: 'INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)', args: [version, appliedAt] });
  }
  await db.batch(statements, 'write');
  return legacy;
}

/**
 * Apply every migration newer than the database's current version. Each one
 * runs as a single atomic batch together with its version record, so a
 * failure leaves the database exactly at the previous version — never
 * half-migrated. Returns the list of versions applied.
 */
export async function migrate(db) {
  const current = await getSchemaVersion(db);

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database is at version ${current}, but this app only knows up to ${SCHEMA_VERSION}. ` +
        'Update the app before opening this database.',
    );
  }

  const applied = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.batch(
      [
        ...splitSql(migration.sql),
        {
          sql: 'INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)',
          args: [migration.version, new Date().toISOString()],
        },
      ],
      'write',
    );
    applied.push(migration.version);
  }
  return applied;
}
