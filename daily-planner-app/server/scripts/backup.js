// Read-only backup: every row of every table (tasks, task_events,
// schema_migrations, …) plus the schema version, as one timestamped JSON file.
//   npm run backup                        (the database in TURSO_DATABASE_URL)
//   npm run backup -- --db <file>         (a local database file)
//   npm run backup -- --out <folder>      (default: ~/todzy-backups, outside the repo)
// It never migrates or writes to the database: only SELECT statements are run.
// The file contains task titles and notes, so it is readable by you only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

export const DEFAULT_BACKUP_DIR = path.join(os.homedir(), 'todzy-backups');

/** Rows of one query as plain objects. */
async function rowsOf(db, sql) {
  const result = await db.execute(sql);
  return result.rows.map((row) => Object.fromEntries(result.columns.map((col) => [col, row[col]])));
}

/**
 * Read every table and write them to `<outDir>/todzy-backup-<timestamp>.json`.
 * Returns { file, schemaVersion, counts } where counts maps table -> rows.
 */
export async function backupDatabase(db, { outDir = DEFAULT_BACKUP_DIR, source = 'database', now = new Date() } = {}) {
  const tables = (await rowsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);

  const data = {};
  for (const table of tables) {
    data[table] = await rowsOf(db, `SELECT * FROM "${table.replaceAll('"', '""')}"`);
  }
  const schemaVersion = tables.includes('schema_migrations')
    ? Math.max(0, ...data.schema_migrations.map((r) => Number(r.version)))
    : null;

  const createdAt = now.toISOString();
  const file = path.join(outDir, `todzy-backup-${createdAt.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  // 'wx': never overwrite an existing backup.
  fs.writeFileSync(file, `${JSON.stringify({ createdAt, source, schemaVersion, tables: data }, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });

  const counts = Object.fromEntries(tables.map((t) => [t, data[t].length]));
  return { file, schemaVersion, counts };
}

// ── Command line ─────────────────────────────────────────────────────────
function usage(message) {
  if (message) console.error(message);
  console.error('Usage: npm run backup -- [--db <file>] [--out <folder>]');
  console.error('Backs up TURSO_DATABASE_URL (from server/.env) unless --db names a local database file.');
  process.exit(1);
}

async function main(argv) {
  let dbFile;
  let outDir = DEFAULT_BACKUP_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') dbFile = argv[++i] ?? usage('--db needs a file');
    else if (argv[i] === '--out') outDir = argv[++i] ?? usage('--out needs a folder');
    else usage(`Unknown argument ${argv[i]}`);
  }

  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let url;
  let source;
  if (dbFile) {
    const file = path.resolve(dbFile);
    if (!fs.existsSync(file)) usage(`No database file at ${file}`);
    url = `file:${file}`;
    source = `local file ${path.basename(file)}`;
  } else {
    url = process.env.TURSO_DATABASE_URL?.trim();
    if (!url) usage('No database: set TURSO_DATABASE_URL or pass --db <file>.');
    source = `Turso ${new URL(url).host}`; // host only: never the token
  }

  const db = createClient({ url, ...(dbFile ? {} : { authToken: process.env.TURSO_AUTH_TOKEN }) });
  try {
    const { file, schemaVersion, counts } = await backupDatabase(db, { outDir: path.resolve(outDir), source });
    console.log(`Backed up ${source} (schema version ${schemaVersion ?? 'unknown'}) to ${file}`);
    console.log('Rows per table:');
    for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(20)} ${n}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
