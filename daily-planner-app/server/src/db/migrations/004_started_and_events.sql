-- Migration 004 — "started" tasks and a privacy-safe event log (database version 4)
--
-- 1. tasks gets a fourth status, 'started' (the user is working on it now),
--    and a nullable startedAt (ISO timestamp of the most recent start; kept
--    after the task leaves 'started'). SQLite can't change a CHECK constraint,
--    so the table is rebuilt: copy -> drop -> rename. Every existing row is
--    kept exactly as it was (same id, values and timestamps); startedAt = NULL.
--
-- 2. task_events records what happened, never what the task says: no title,
--    notes or any other free text. Used to measure "tasks started".
--
-- The whole file runs in one atomic batch, so a failure anywhere leaves the
-- database at version 3 with its tasks untouched.

CREATE TABLE tasks_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId         TEXT    NOT NULL CHECK (length(trim(ownerId)) > 0),
  title           TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  category        TEXT    NOT NULL CHECK (category IN ('Study', 'Gym', 'Career', 'Personal')),
  scheduledDate   TEXT    NOT NULL CHECK (scheduledDate GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  startTime       TEXT             CHECK (startTime IS NULL OR startTime GLOB '[0-2][0-9]:[0-5][0-9]'),
  endTime         TEXT             CHECK (endTime   IS NULL OR endTime   GLOB '[0-2][0-9]:[0-5][0-9]'),
  notes           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'completed', 'dismissed')),
  completedAt     TEXT,
  createdAt       TEXT    NOT NULL,
  updatedAt       TEXT    NOT NULL,
  durationMinutes INTEGER NOT NULL DEFAULT 60
                    CHECK (typeof(durationMinutes) = 'integer' AND durationMinutes BETWEEN 5 AND 480),
  priority        TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  dueDate         TEXT             CHECK (dueDate IS NULL OR dueDate GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  isFixed         INTEGER NOT NULL DEFAULT 0 CHECK (isFixed IN (0, 1) AND (isFixed = 0 OR startTime IS NOT NULL)),
  energy          TEXT             CHECK (energy IS NULL OR energy IN ('deep', 'normal', 'light')),
  startedAt       TEXT,

  -- An end time only makes sense after a start time.
  CHECK (endTime IS NULL OR (startTime IS NOT NULL AND endTime > startTime)),
  -- completedAt is set exactly when the task is completed.
  CHECK (
    (status = 'completed' AND completedAt IS NOT NULL)
    OR
    (status <> 'completed' AND completedAt IS NULL)
  ),
  -- A started task always knows when it was started.
  CHECK (status <> 'started' OR startedAt IS NOT NULL)
);

INSERT INTO tasks_new (id, ownerId, title, category, scheduledDate, startTime, endTime, notes,
                       status, completedAt, createdAt, updatedAt,
                       durationMinutes, priority, dueDate, isFixed, energy, startedAt)
SELECT id, ownerId, title, category, scheduledDate, startTime, endTime, notes,
       status, completedAt, createdAt, updatedAt,
       durationMinutes, priority, dueDate, isFixed, energy, NULL
  FROM tasks;

-- Keep the AUTOINCREMENT counter: events refer to task ids, so the id of a
-- deleted task must never be handed out again.
INSERT INTO sqlite_sequence (name, seq)
SELECT 'tasks_new', seq FROM sqlite_sequence
 WHERE name = 'tasks'
   AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'tasks_new');

UPDATE sqlite_sequence
   SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tasks'), 0))
 WHERE name = 'tasks_new';

DROP TABLE tasks;

ALTER TABLE tasks_new RENAME TO tasks;

-- Indexes went with the old table; recreate them. ownerId leads each one.

-- Today view: WHERE ownerId = ? AND scheduledDate = ? AND status IN (...)
CREATE INDEX idx_tasks_owner_date_status ON tasks (ownerId, scheduledDate, status);

-- Backlog view: WHERE ownerId = ? AND status IN ('open', 'started') AND scheduledDate < ?
CREATE INDEX idx_tasks_owner_status_date ON tasks (ownerId, status, scheduledDate);

-- Planning queries will look for upcoming deadlines.
CREATE INDEX idx_tasks_owner_due_date ON tasks (ownerId, dueDate) WHERE dueDate IS NOT NULL;

-- Only one started task per user, enforced by the database itself.
CREATE UNIQUE INDEX idx_tasks_one_started_per_owner ON tasks (ownerId) WHERE status = 'started';

-- Event log. taskId has no foreign key on purpose: events outlive deleted
-- tasks (they hold no task text). localDate is the user's own calendar day
-- ('YYYY-MM-DD', from the browser), so "days" follow the user's time zone.
CREATE TABLE task_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId    TEXT    NOT NULL CHECK (length(trim(ownerId)) > 0),
  taskId     INTEGER,
  type       TEXT    NOT NULL CHECK (type IN ('app_opened', 'task_created', 'task_started', 'task_paused',
                                              'task_completed', 'task_reopened', 'task_rescheduled',
                                              'task_dismissed')),
  occurredAt TEXT    NOT NULL,
  localDate  TEXT    NOT NULL CHECK (localDate GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),

  -- app_opened is the only event that isn't about one task.
  CHECK ((type = 'app_opened') = (taskId IS NULL))
);

-- Metrics read one user's events in time order.
CREATE INDEX idx_task_events_owner_time ON task_events (ownerId, occurredAt);

-- At most one app_opened per user per local day.
CREATE UNIQUE INDEX idx_task_events_app_opened_per_day ON task_events (ownerId, localDate) WHERE type = 'app_opened';
