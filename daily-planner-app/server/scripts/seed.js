// Replace ONE user's tasks with the sample tasks (other users are untouched).
//   npm run seed -- <clerk_user_id>      (from the project root or /server)
// The user ID is the Clerk user ID (user_...), shown in the Clerk Dashboard.
// Dates are relative to today, so re-running gives a fresh, realistic demo.
import { openDatabase } from '../src/db/connection.js';
import { resetWithSampleTasks } from '../src/db/seed.js';
import { localToday } from '../src/lib/dates.js';

const ownerId = process.argv[2]?.trim();
if (!ownerId) {
  console.error('Usage: npm run seed -- <clerk_user_id>');
  console.error('Replaces that user\'s tasks with sample tasks. Find the ID (user_...) in the Clerk Dashboard → Users.');
  process.exit(1);
}

const db = await openDatabase();
const today = localToday();
const count = await resetWithSampleTasks(db, ownerId, today);
db.close();

console.log(`Replaced the tasks of ${ownerId} with ${count} sample tasks (today = ${today}).`);
