import { nowIso } from '../lib/dates.js';

/**
 * Privacy-safe event log. An event says WHAT happened and WHEN, never what a
 * task says: there is deliberately no column for a title, notes or any other
 * free text. Task events are written by the server in the same atomic batch
 * as the change they describe; the browser may only report app_opened.
 */
export const EVENT_TYPES = [
  'app_opened',
  'task_created',
  'task_started',
  'task_paused',
  'task_completed',
  'task_reopened',
  'task_rescheduled',
  'task_dismissed',
];

/** The only event type a client is allowed to send. */
export const CLIENT_EVENT_TYPES = ['app_opened'];

const INSERT = `INSERT INTO task_events (ownerId, taskId, type, occurredAt, localDate) VALUES (?, ?, ?, ?, ?)`;

function requireOwner(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new Error('Event log called without an owner');
  }
  return ownerId;
}

/**
 * Build (but don't run) the INSERT for one task event, so callers can put it
 * in the same batch as the task change it describes.
 */
export function taskEventStatement(ownerId, taskId, type, localDate, occurredAt = nowIso()) {
  if (!EVENT_TYPES.includes(type) || type === 'app_opened') throw new Error(`Not a task event type: ${type}`);
  return { sql: INSERT, args: [requireOwner(ownerId), taskId, type, occurredAt, localDate] };
}

export function createEventRepository(db) {
  return {
    /**
     * Record that `ownerId` opened the app on `localDate`. At most one per
     * user per local day (a unique index makes this race-safe). Returns true
     * if this call stored it, false if that day was already recorded.
     */
    async recordAppOpened(ownerId, localDate) {
      const result = await db.execute({
        sql: `INSERT OR IGNORE INTO task_events (ownerId, taskId, type, occurredAt, localDate)
              VALUES (?, NULL, 'app_opened', ?, ?)`,
        args: [requireOwner(ownerId), nowIso(), localDate],
      });
      return result.rowsAffected > 0;
    },
  };
}
