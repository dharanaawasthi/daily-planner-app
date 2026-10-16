import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './db/connection.js';

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

let db;
try {
  db = await openDatabase();
} catch (err) {
  console.error(`Could not open the database: ${err.message}`);
  process.exit(1);
}

const server = createApp({ db }).listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}/api`);
  console.log(process.env.TURSO_DATABASE_URL ? 'Database: Turso (hosted)' : 'Database: local file (development only)');
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
