import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './db/connection.js';
import { seedIfEmpty } from './db/seed.js';

// Load server/.env (ignored by Git) if present; real environment variables win.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

if (!process.env.CLERK_SECRET_KEY) {
  console.error('CLERK_SECRET_KEY is not set. Copy server/.env.example to server/.env and add your Clerk secret key.');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3001;

const db = openDatabase();

// First run: fill an empty database with sample tasks (set SEED_ON_EMPTY=false to skip).
if (process.env.SEED_ON_EMPTY !== 'false') {
  const seeded = seedIfEmpty(db);
  if (seeded) console.log(`Seeded ${seeded} sample tasks.`);
}

const server = createApp({ db }).listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}/api`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
