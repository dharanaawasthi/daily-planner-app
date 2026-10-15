import { addDays, localToday } from '../lib/dates.js';
import { createTaskRepository } from './taskRepository.js';

/**
 * Sample tasks, positioned relative to `today` so a seeded account always shows:
 *  - a Today list with timed and untimed tasks, plus a couple already completed
 *  - a Backlog of open tasks from earlier days
 *  - past tasks that are completed or dismissed (and so NOT in the backlog)
 *  - a few upcoming tasks
 * Each task also carries planning data (duration, priority, due date, whether
 * its time is fixed, and the energy it needs) for the upcoming day planner.
 */
export function sampleTasks(today) {
  const day = (offset) => addDays(today, offset);

  return [
    // ── Today ────────────────────────────────────────────────────────────
    { title: 'Morning run + stretching', category: 'Gym', scheduledDate: day(0), startTime: '07:00', endTime: '07:45', status: 'completed', notes: '5 km easy pace, 10 min mobility after.', durationMinutes: 45, priority: 'medium', energy: 'normal' },
    { title: 'Review linear algebra lecture notes', category: 'Study', scheduledDate: day(0), startTime: '09:00', endTime: '10:30', notes: 'Focus on eigenvalues and diagonalisation. Redo examples 4.2–4.5.', durationMinutes: 90, priority: 'high', dueDate: day(2), energy: 'deep' },
    { title: 'Apply to two backend developer roles', category: 'Career', scheduledDate: day(0), startTime: '11:00', endTime: '12:00', notes: 'Tailor the CV summary for each posting.', durationMinutes: 60, priority: 'high', dueDate: day(1), energy: 'normal' },
    { title: 'Lunch with Sara', category: 'Personal', scheduledDate: day(0), startTime: '13:30', endTime: '14:30', status: 'completed', durationMinutes: 60, priority: 'low', isFixed: true, energy: 'light' },
    { title: 'Mock interview: system design', category: 'Career', scheduledDate: day(0), startTime: '16:00', endTime: '17:00', notes: 'Practice: design a URL shortener. Time-box to 45 minutes.', durationMinutes: 60, priority: 'high', energy: 'deep' },
    { title: 'Upper body strength session', category: 'Gym', scheduledDate: day(0), startTime: '18:00', endTime: '19:00', notes: 'Bench 4×6, rows 4×8, overhead press 3×8.', durationMinutes: 60, priority: 'medium', energy: 'normal' },
    { title: 'Read chapter 5 of Operating Systems', category: 'Study', scheduledDate: day(0), notes: 'Scheduling algorithms. No fixed time — whenever there is a gap.', durationMinutes: 45, priority: 'medium', dueDate: day(4), energy: 'deep' },
    { title: 'Call Mom', category: 'Personal', scheduledDate: day(0), durationMinutes: 20, priority: 'medium', energy: 'light' },

    // ── Earlier days, still open → Backlog ──────────────────────────────
    { title: 'Finish problem set 3', category: 'Study', scheduledDate: day(-1), startTime: '19:00', endTime: '21:00', notes: 'Questions 6–10 left.', durationMinutes: 120, priority: 'high', dueDate: day(1), energy: 'deep' },
    { title: 'Pay the phone bill', category: 'Personal', scheduledDate: day(-1), durationMinutes: 10, priority: 'high', dueDate: day(0), energy: 'light' },
    { title: 'Update LinkedIn headline and summary', category: 'Career', scheduledDate: day(-3), startTime: '10:00', endTime: '10:30', durationMinutes: 30, priority: 'low', energy: 'normal' },
    { title: 'Mobility routine (hips + shoulders)', category: 'Gym', scheduledDate: day(-4), durationMinutes: 20, priority: 'low', energy: 'light' },

    // ── Earlier days, finished or dropped → NOT in the backlog ───────────
    { title: 'Leg day', category: 'Gym', scheduledDate: day(-1), startTime: '07:00', endTime: '08:00', status: 'completed', durationMinutes: 60, energy: 'normal' },
    { title: 'Submit lab report', category: 'Study', scheduledDate: day(-2), startTime: '15:00', endTime: '16:00', status: 'completed', durationMinutes: 60, priority: 'high', dueDate: day(-2), energy: 'deep' },
    { title: 'Reorganise bookshelf', category: 'Personal', scheduledDate: day(-5), status: 'dismissed', notes: 'Not a priority this month.', durationMinutes: 90, priority: 'low', energy: 'light' },

    // ── Upcoming ─────────────────────────────────────────────────────────
    { title: 'Swim — 1,500 m', category: 'Gym', scheduledDate: day(1), startTime: '07:30', endTime: '08:30', durationMinutes: 60, energy: 'normal' },
    { title: 'Study group: algorithms', category: 'Study', scheduledDate: day(1), startTime: '17:00', endTime: '18:30', durationMinutes: 90, priority: 'medium', isFixed: true, energy: 'deep' },
    { title: 'Coffee chat with mentor', category: 'Career', scheduledDate: day(3), startTime: '12:00', endTime: '12:45', notes: 'Ask about moving from backend into platform engineering.', durationMinutes: 45, priority: 'medium', isFixed: true, energy: 'normal' },
    { title: 'Weekly grocery shop', category: 'Personal', scheduledDate: day(2), durationMinutes: 45, priority: 'low', energy: 'light' },
  ];
}

/**
 * Give one user the sample tasks (does not clear their existing tasks).
 * Returns the count.
 */
export function seedSampleTasks(db, ownerId, today = localToday()) {
  const repo = createTaskRepository(db);
  const tasks = sampleTasks(today);
  repo.transaction(() => {
    for (const task of tasks) repo.create(ownerId, task);
  });
  return tasks.length;
}

/**
 * Replace one user's tasks with the sample tasks. Other users' tasks are
 * untouched.
 */
export function resetWithSampleTasks(db, ownerId, today = localToday()) {
  const repo = createTaskRepository(db);
  return repo.transaction(() => {
    repo.count(ownerId); // validates ownerId before anything is deleted
    db.prepare('DELETE FROM tasks WHERE ownerId = ?').run(ownerId);
    return seedSampleTasks(db, ownerId, today);
  });
}
