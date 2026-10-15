import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

export const DEFAULT_DB_PATH = path.resolve(here, '../../data/planner.db');

/**
 * Migrations are the numbered .sql files in ./migrations, applied in order.
 * The number in the file name is the database version it produces:
 *   001_initial.sql         -> version 1
 *   002_planning_fields.sql -> version 2
 * SQLite's built-in `user_version` records which ones have run.
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
 * Open (and create if needed) the SQLite database, then bring the schema up
 * to date. Pass ':memory:' for a throwaway database (used by the tests).
 */
export function openDatabase(file = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/**
 * Apply every migration newer than the database's current version. Each one
 * runs in its own transaction together with the version bump, so a failure
 * leaves the database exactly at the previous version — never half-migrated.
 * Returns the list of versions applied.
 */
export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database is at version ${current}, but this app only knows up to ${SCHEMA_VERSION}. ` +
        'Update the app before opening this database.',
    );
  }

  const applied = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
    applied.push(migration.version);
  }
  return applied;
}
