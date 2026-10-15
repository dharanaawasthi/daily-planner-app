import { createApp } from './app.js';
import { openDatabase } from './db/connection.js';
import { seedIfEmpty } from './db/seed.js';

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
