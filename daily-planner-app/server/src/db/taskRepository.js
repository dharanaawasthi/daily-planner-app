import { localToday, nowIso } from '../lib/dates.js';
import { badRequest, conflict } from '../lib/errors.js';
import { taskEventStatement } from './events.js';
import { PLANNING_DEFAULTS, checkTaskRules, hasErrors } from '../lib/validation.js';

const COLUMNS = `id, title, category, scheduledDate, startTime, endTime, notes,
                 status, completedAt, durationMinutes, priority, dueDate, isFixed, energy,
                 startedAt, createdAt, updatedAt`;

// Timed tasks first, in start-time order; untimed ("anytime") tasks after,
// in the order they were created.
const BY_START_TIME = `ORDER BY startTime IS NULL, startTime, endTime, createdAt, id`;

// Not-yet-done lists pin the one started task to the top, then the usual order.
const STARTED_FIRST = `status <> 'started'`;

// "Is task ? of owner ? still open?" Guards every statement of a start, so a
// start that lost a race changes nothing at all.
const TARGET_IS_OPEN = `EXISTS (SELECT 1 FROM tasks t WHERE t.id = ? AND t.ownerId = ? AND t.status = 'open')`;

const SQL = {
  byId: `SELECT ${COLUMNS} FROM tasks WHERE id = ? AND ownerId = ?`,

  insert: `
    INSERT INTO tasks (ownerId, title, category, scheduledDate, startTime, endTime, notes,
                       status, completedAt, durationMinutes, priority, dueDate, isFixed, energy,
                       createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  update: `
    UPDATE tasks
       SET title = ?, category = ?, scheduledDate = ?,
           startTime = ?, endTime = ?, notes = ?,
           status = ?, completedAt = ?,
           durationMinutes = ?, priority = ?, dueDate = ?,
           isFixed = ?, energy = ?,
           updatedAt = ?
     WHERE id = ? AND ownerId = ?`,

  remove: `DELETE FROM tasks WHERE id = ? AND ownerId = ?`,

  forDateAndStatus: `
    SELECT ${COLUMNS} FROM tasks
     WHERE ownerId = ? AND scheduledDate = ? AND status = ?
     ${BY_START_TIME}`,

  // Today's not-yet-done tasks: open or started, the started one first.
  forDateNotDone: `
    SELECT ${COLUMNS} FROM tasks
     WHERE ownerId = ? AND scheduledDate = ? AND status IN ('open', 'started')
     ORDER BY ${STARTED_FIRST}, startTime IS NULL, startTime, endTime, createdAt, id`,

  // The backlog rule, and nothing else: not done (open or started) AND
  // scheduled before today.
  backlog: `
    SELECT ${COLUMNS} FROM tasks
     WHERE ownerId = ? AND status IN ('open', 'started') AND scheduledDate < ?
     ORDER BY ${STARTED_FIRST}, scheduledDate, startTime IS NULL, startTime, createdAt, id`,

  otherStarted: `SELECT 1 FROM tasks WHERE ownerId = ? AND status = 'started' AND id <> ? LIMIT 1`,

  // ── Start (run together in one batch, in this order) ──────────────────
  // 1. log task_paused for the owner's other started task (if any)
  pauseEvents: `
    INSERT INTO task_events (ownerId, taskId, type, occurredAt, localDate)
    SELECT ownerId, id, 'task_paused', ?, ? FROM tasks
     WHERE ownerId = ? AND status = 'started' AND id <> ? AND ${TARGET_IS_OPEN}`,
  // 2. move it back to open
  pauseOthers: `
    UPDATE tasks SET status = 'open', updatedAt = ?
     WHERE ownerId = ? AND status = 'started' AND id <> ? AND ${TARGET_IS_OPEN}`,
  // 3. start this one
  start: `
    UPDATE tasks SET status = 'started', startedAt = ?, updatedAt = ?
     WHERE id = ? AND ownerId = ? AND status = 'open'`,
  // 4. log task_started, only if step 3 really started it
  startedEvent: `
    INSERT INTO task_events (ownerId, taskId, type, occurredAt, localDate)
    SELECT ownerId, id, 'task_started', ?, ? FROM tasks
     WHERE id = ? AND ownerId = ? AND status = 'started' AND startedAt = ?`,

  // task_created for the row the previous statement of the batch inserted.
  createdEvent: `
    INSERT INTO task_events (ownerId, taskId, type, occurredAt, localDate)
    VALUES (?, last_insert_rowid(), 'task_created', ?, ?)`,

  count: `SELECT COUNT(*) AS n FROM tasks WHERE ownerId = ?`,
};

/**
 * Every task belongs to one owner (the verified Clerk user ID). Refuse to run
 * any query without one, so a wiring mistake can never fall back to "all tasks".
 */
function requireOwner(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new Error('Task repository called without an owner');
  }
  return ownerId;
}

/** Database rows → plain objects keyed by column name. */
function rowsOf(result) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((col) => [col, row[col]])));
}

/** SQLite stores booleans as 0/1; the API speaks true/false. */
function toTask(row) {
  if (!row) return null;
  return { ...row, isFixed: Number(row.isFixed) === 1 };
}

/** The user-editable values, in the column order of SQL.insert / SQL.update. */
function editableValues(task) {
  return [
    task.title,
    task.category,
    task.scheduledDate,
    task.startTime,
    task.endTime,
    task.notes,
    task.status,
    task.completedAt,
    task.durationMinutes,
    task.priority,
    task.dueDate,
    task.isFixed ? 1 : 0,
    task.energy,
  ];
}

/** Keep completedAt in sync with status. */
function stampCompletion(task, previous) {
  if (task.status !== 'completed') return null;
  if (previous?.status === 'completed' && previous.completedAt) return previous.completedAt;
  return nowIso();
}

/**
 * The events that describe going from `previous` to `next` (one PATCH,
 * reschedule or dismiss). Leaving 'started' by being rescheduled or dismissed
 * logs only that action, not an extra task_paused.
 */
function eventTypesFor(previous, next) {
  const types = [];
  const moved = next.scheduledDate !== previous.scheduledDate;
  if (next.status !== previous.status) {
    if (next.status === 'completed') types.push('task_completed');
    else if (next.status === 'dismissed') types.push('task_dismissed');
    else if (previous.status === 'completed' || previous.status === 'dismissed') types.push('task_reopened');
    else if (previous.status === 'started' && next.status === 'open' && !moved) types.push('task_paused');
  }
  if (moved) types.push('task_rescheduled');
  return types;
}

function assertValid(task) {
  const errors = checkTaskRules(task);
  if (hasErrors(errors)) throw badRequest('Validation failed', errors);
}

/**
 * All SQL for tasks lives here. Routes call these methods and never touch
 * the database directly. Every method is async and returns API-shaped tasks.
 *
 * Every method takes the owner's ID first and every statement filters on it,
 * so a task that belongs to someone else behaves exactly like one that
 * doesn't exist (null / false). ownerId is never taken from task fields: it
 * is bound separately from the authenticated user.
 */
export function createTaskRepository(db) {
  async function query(sql, args) {
    return rowsOf(await db.execute({ sql, args }));
  }

  const repo = {
    async findById(ownerId, id) {
      const [row] = await query(SQL.byId, [id, requireOwner(ownerId)]);
      return toTask(row);
    },

    /** Flexible list for future views: optional date / status / category / range filters. */
    async list(ownerId, { date, from, to, status, category } = {}) {
      const where = ['ownerId = ?'];
      const args = [requireOwner(ownerId)];
      if (date) { where.push('scheduledDate = ?'); args.push(date); }
      if (from) { where.push('scheduledDate >= ?'); args.push(from); }
      if (to) { where.push('scheduledDate <= ?'); args.push(to); }
      if (status) { where.push('status = ?'); args.push(status); }
      if (category) { where.push('category = ?'); args.push(category); }

      const sql = `SELECT ${COLUMNS} FROM tasks
                   WHERE ${where.join(' AND ')}
                   ORDER BY scheduledDate, startTime IS NULL, startTime, createdAt, id`;
      return (await query(sql, args)).map(toTask);
    },

    /**
     * Everything the Today view needs, already split and sorted by start time.
     * `open` holds every not-yet-done task (open or started, started first).
     */
    async forDay(ownerId, date) {
      requireOwner(ownerId);
      const [open, completed] = await Promise.all([
        query(SQL.forDateNotDone, [ownerId, date]),
        query(SQL.forDateAndStatus, [ownerId, date, 'completed']),
      ]);
      return { open: open.map(toTask), completed: completed.map(toTask) };
    },

    async backlog(ownerId, today) {
      return (await query(SQL.backlog, [requireOwner(ownerId), today])).map(toTask);
    },

    /**
     * Build (but don't run) the INSERT for a new task owned by `ownerId`:
     * applies defaults and validates. Used by create() and by the seed,
     * which runs many inserts in one atomic batch. Any ownerId in `fields`
     * is ignored.
     */
    insertStatement(ownerId, fields) {
      requireOwner(ownerId);
      const now = nowIso();
      const task = {
        title: fields.title,
        category: fields.category,
        scheduledDate: fields.scheduledDate,
        startTime: fields.startTime ?? null,
        endTime: fields.endTime ?? null,
        notes: fields.notes ?? '',
        status: fields.status ?? 'open',
        // Planning fields: an omitted field gets its default; an explicit
        // null (allowed for dueDate and energy) is kept as "not set".
        durationMinutes: fields.durationMinutes ?? PLANNING_DEFAULTS.durationMinutes,
        priority: fields.priority ?? PLANNING_DEFAULTS.priority,
        dueDate: 'dueDate' in fields ? fields.dueDate : PLANNING_DEFAULTS.dueDate,
        isFixed: fields.isFixed ?? PLANNING_DEFAULTS.isFixed,
        energy: 'energy' in fields ? fields.energy : PLANNING_DEFAULTS.energy,
      };
      task.completedAt = stampCompletion(task, null);
      assertValid(task);

      return { sql: SQL.insert, args: [ownerId, ...editableValues(task), now, now] };
    },

    /**
     * Create a task owned by `ownerId` (any ownerId in `fields` is ignored),
     * and log task_created in the same atomic batch. `localDate` is the
     * user's calendar day for the event.
     */
    async create(ownerId, fields, { localDate = localToday() } = {}) {
      const insert = repo.insertStatement(ownerId, fields);
      const [result] = await db.batch(
        [insert, { sql: SQL.createdEvent, args: [ownerId, nowIso(), localDate] }],
        'write',
      );
      return repo.findById(ownerId, Number(result.lastInsertRowid));
    },

    /**
     * Partial update. Returns the updated task, or null if the owner has no
     * such task. The matching events are written in the same atomic batch.
     */
    async update(ownerId, id, changes, { localDate = localToday() } = {}) {
      const existing = await repo.findById(ownerId, id);
      if (!existing) return null;

      const task = { ...existing, ...changes };

      // Clearing the start time also clears the end time unless the caller
      // set an end time explicitly (which then fails validation, as it should).
      if (changes.startTime === null && !('endTime' in changes)) task.endTime = null;

      // Unticking a completed task: back to 'started' if it was started
      // before and nothing else is started now; otherwise back to 'open'.
      if (existing.status === 'completed' && changes.status === 'open' && existing.startedAt) {
        const [other] = await query(SQL.otherStarted, [ownerId, id]);
        if (!other) task.status = 'started';
      }

      // A started task moved to another day is no longer being worked on.
      if (task.status === 'started' && task.scheduledDate !== existing.scheduledDate) task.status = 'open';

      task.completedAt = stampCompletion(task, existing);
      assertValid(task);

      const now = nowIso();
      await db.batch(
        [
          { sql: SQL.update, args: [...editableValues(task), now, id, ownerId] },
          ...eventTypesFor(existing, task).map((type) => taskEventStatement(ownerId, id, type, localDate, now)),
        ],
        'write',
      );
      return repo.findById(ownerId, id);
    },

    /**
     * Start a task: status 'started', startedAt = now. The owner's other
     * started task (at most one) goes back to 'open' with a task_paused event.
     * Everything runs in one atomic batch.
     *
     * Returns the task, or null if the owner has no such task. Starting an
     * already-started task changes nothing. Completed and dismissed tasks
     * can't be started (409).
     */
    async start(ownerId, id, { localDate = localToday() } = {}) {
      requireOwner(ownerId);
      const existing = await repo.findById(ownerId, id);
      if (!existing) return null;
      if (existing.status === 'started') return existing;
      if (existing.status !== 'open') throw conflict(`Only open tasks can be started (this one is ${existing.status})`);

      const now = nowIso();
      const target = [id, ownerId];
      const results = await db.batch(
        [
          { sql: SQL.pauseEvents, args: [now, localDate, ownerId, id, ...target] },
          { sql: SQL.pauseOthers, args: [now, ownerId, id, ...target] },
          { sql: SQL.start, args: [now, now, id, ownerId] },
          { sql: SQL.startedEvent, args: [now, localDate, id, ownerId, now] },
        ],
        'write',
      );

      const task = await repo.findById(ownerId, id);
      if (results[2].rowsAffected === 0 && task && task.status !== 'started') {
        // The task changed between reading and starting it; nothing was written.
        throw conflict(`Only open tasks can be started (this one is ${task.status})`);
      }
      return task;
    },

    async remove(ownerId, id) {
      const result = await db.execute({ sql: SQL.remove, args: [id, requireOwner(ownerId)] });
      return result.rowsAffected > 0;
    },

    async count(ownerId) {
      const [row] = await query(SQL.count, [requireOwner(ownerId)]);
      return Number(row.n);
    },
  };

  return repo;
}
