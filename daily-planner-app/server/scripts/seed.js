// Reset the database to the sample tasks.
//   npm run seed            (from the project root or /server)
// Dates are relative to today, so re-running gives a fresh, realistic demo.
import { openDatabase } from '../src/db/connection.js';
import { resetWithSampleTasks } from '../src/db/seed.js';
import { localToday } from '../src/lib/dates.js';

const db = openDatabase();
const today = localToday();
const count = resetWithSampleTasks(db, today);
db.close();

console.log(`Database reset with ${count} sample tasks (today = ${today}).`);
