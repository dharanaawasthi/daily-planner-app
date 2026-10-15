import { nowIso } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import { PLANNING_DEFAULTS, checkTaskRules, hasErrors } from '../lib/validation.js';

const COLUMNS = `id, title, category, scheduledDate, startTime, endTime, notes,
                 status, completedAt, durationMinutes, priority, dueDate, isFixed, energy,
                 createdAt, updatedAt`;

// Timed tasks first, in start-time order; untimed ("anytime") tasks after,
// in the order they were created.
const BY_START_TIME = `ORDER BY startTime IS NULL, startTime, endTime, createdAt, id`;

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

/** SQLite stores booleans as 0/1; the API speaks true/false. */
function toTask(row) {
  if (!row) return null;
  return { ...row, isFixed: row.isFixed === 1 };
}

/**
 * The exact parameters the INSERT/UPDATE statements expect. ownerId is never
 * taken from task fields: it is bound separately from the authenticated user.
 */
function toRow(task) {
  return {
    title: task.title,
    category: task.category,
    scheduledDate: task.scheduledDate,
    startTime: task.startTime,
    endTime: task.endTime,
    notes: task.notes,
    status: task.status,
    completedAt: task.completedAt,
    durationMinutes: task.durationMinutes,
    priority: task.priority,
    dueDate: task.dueDate,
    isFixed: task.isFixed ? 1 : 0,
    energy: task.energy,
    updatedAt: task.updatedAt,
  };
}

/**
 * All SQL for tasks lives here. Routes call these methods and never touch
 * the database directly. Every method returns API-shaped tasks.
 *
 * Every method takes the owner's ID first and every statement filters on it,
 * so a task that belongs to someone else behaves exactly like one that
 * doesn't exist (null / false).
 */
export function createTaskRepository(db) {
  const stmt = {
    byId: db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ? AND ownerId = ?`),

    insert: db.prepare(`
      INSERT INTO tasks (ownerId, title, category, scheduledDate, startTime, endTime, notes,
                         status, completedAt, durationMinutes, priority, dueDate, isFixed, energy,
                         createdAt, updatedAt)
      VALUES (@ownerId, @title, @category, @scheduledDate, @startTime, @endTime, @notes,
              @status, @completedAt, @durationMinutes, @priority, @dueDate, @isFixed, @energy,
              @createdAt, @updatedAt)`),

    update: db.prepare(`
      UPDATE tasks
         SET title = @title, category = @category, scheduledDate = @scheduledDate,
             startTime = @startTime, endTime = @endTime, notes = @notes,
             status = @status, completedAt = @completedAt,
             durationMinutes = @durationMinutes, priority = @priority, dueDate = @dueDate,
             isFixed = @isFixed, energy = @energy,
             updatedAt = @updatedAt
       WHERE id = @id AND ownerId = @ownerId`),

    remove: db.prepare(`DELETE FROM tasks WHERE id = ? AND ownerId = ?`),

    forDateAndStatus: db.prepare(`
      SELECT ${COLUMNS} FROM tasks
       WHERE ownerId = ? AND scheduledDate = ? AND status = ?
       ${BY_START_TIME}`),

    // The backlog rule, and nothing else: open AND scheduled before today.
    backlog: db.prepare(`
      SELECT ${COLUMNS} FROM tasks
       WHERE ownerId = ? AND status = 'open' AND scheduledDate < ?
       ORDER BY scheduledDate, startTime IS NULL, startTime, createdAt, id`),

    count: db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE ownerId = ?`),
  };

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

  return {
    findById(ownerId, id) {
      return toTask(stmt.byId.get(id, requireOwner(ownerId)));
    },

    /** Flexible list for future views: optional date / status / category / range filters. */
    list(ownerId, { date, from, to, status, category } = {}) {
      const where = ['ownerId = ?'];
      const params = [requireOwner(ownerId)];
      if (date) { where.push('scheduledDate = ?'); params.push(date); }
      if (from) { where.push('scheduledDate >= ?'); params.push(from); }
      if (to) { where.push('scheduledDate <= ?'); params.push(to); }
      if (status) { where.push('status = ?'); params.push(status); }
      if (category) { where.push('category = ?'); params.push(category); }

      const sql = `SELECT ${COLUMNS} FROM tasks
                   WHERE ${where.join(' AND ')}
                   ORDER BY scheduledDate, startTime IS NULL, startTime, createdAt, id`;
      return db.prepare(sql).all(...params).map(toTask);
    },

    /** Everything the Today view needs, already split and sorted by start time. */
    forDay(ownerId, date) {
      requireOwner(ownerId);
      return {
        open: stmt.forDateAndStatus.all(ownerId, date, 'open').map(toTask),
        completed: stmt.forDateAndStatus.all(ownerId, date, 'completed').map(toTask),
      };
    },

    backlog(ownerId, today) {
      return stmt.backlog.all(requireOwner(ownerId), today).map(toTask);
    },

    /** Create a task owned by `ownerId` (any ownerId in `fields` is ignored). */
    create(ownerId, fields) {
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
        updatedAt: now,
      };
      task.completedAt = stampCompletion(task, null);
      assertValid(task);

      const { lastInsertRowid } = stmt.insert.run({ ...toRow(task), ownerId, createdAt: now });
      return this.findById(ownerId, Number(lastInsertRowid));
    },

    /** Partial update. Returns the updated task, or null if the owner has no such task. */
    update(ownerId, id, changes) {
      const existing = this.findById(ownerId, id);
      if (!existing) return null;

      const task = { ...existing, ...changes };

      // Clearing the start time also clears the end time unless the caller
      // set an end time explicitly (which then fails validation, as it should).
      if (changes.startTime === null && !('endTime' in changes)) task.endTime = null;

      task.completedAt = stampCompletion(task, existing);
      task.updatedAt = nowIso();
      assertValid(task);

      stmt.update.run({ ...toRow(task), id, ownerId });
      return this.findById(ownerId, id);
    },

    remove(ownerId, id) {
      return stmt.remove.run(id, requireOwner(ownerId)).changes > 0;
    },

    count(ownerId) {
      return stmt.count.get(requireOwner(ownerId)).n;
    },

    /** Run several repository calls atomically. */
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}
