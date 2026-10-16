import { nowIso } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import { PLANNING_DEFAULTS, checkTaskRules, hasErrors } from '../lib/validation.js';

const COLUMNS = `id, title, category, scheduledDate, startTime, endTime, notes,
                 status, completedAt, durationMinutes, priority, dueDate, isFixed, energy,
                 createdAt, updatedAt`;

// Timed tasks first, in start-time order; untimed ("anytime") tasks after,
// in the order they were created.
const BY_START_TIME = `ORDER BY startTime IS NULL, startTime, endTime, createdAt, id`;

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

  // The backlog rule, and nothing else: open AND scheduled before today.
  backlog: `
    SELECT ${COLUMNS} FROM tasks
     WHERE ownerId = ? AND status = 'open' AND scheduledDate < ?
     ORDER BY scheduledDate, startTime IS NULL, startTime, createdAt, id`,

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

    /** Everything the Today view needs, already split and sorted by start time. */
    async forDay(ownerId, date) {
      requireOwner(ownerId);
      const [open, completed] = await Promise.all([
        query(SQL.forDateAndStatus, [ownerId, date, 'open']),
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

    /** Create a task owned by `ownerId` (any ownerId in `fields` is ignored). */
    async create(ownerId, fields) {
      const result = await db.execute(repo.insertStatement(ownerId, fields));
      return repo.findById(ownerId, Number(result.lastInsertRowid));
    },

    /** Partial update. Returns the updated task, or null if the owner has no such task. */
    async update(ownerId, id, changes) {
      const existing = await repo.findById(ownerId, id);
      if (!existing) return null;

      const task = { ...existing, ...changes };

      // Clearing the start time also clears the end time unless the caller
      // set an end time explicitly (which then fails validation, as it should).
      if (changes.startTime === null && !('endTime' in changes)) task.endTime = null;

      task.completedAt = stampCompletion(task, existing);
      assertValid(task);

      await db.execute({ sql: SQL.update, args: [...editableValues(task), nowIso(), id, ownerId] });
      return repo.findById(ownerId, id);
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
