-- Migration 003 — private tasks per signed-in account (database version 3)
--
-- Every task now belongs to one Clerk user (ownerId = the verified Clerk user
-- ID from the session token; never a value sent by the browser).
--
-- RESET: the tasks that existed before this version were shared test data
-- with no owner, so they are deliberately DELETED rather than migrated. The
-- table is recreated (SQLite can't add a NOT NULL column without a default),
-- and dropping it also resets the AUTOINCREMENT counter in sqlite_sequence.

DROP TABLE IF EXISTS tasks;

CREATE TABLE tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId         TEXT    NOT NULL CHECK (length(trim(ownerId)) > 0),
  title           TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  category        TEXT    NOT NULL CHECK (category IN ('Study', 'Gym', 'Career', 'Personal')),
  scheduledDate   TEXT    NOT NULL CHECK (scheduledDate GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  startTime       TEXT             CHECK (startTime IS NULL OR startTime GLOB '[0-2][0-9]:[0-5][0-9]'),
  endTime         TEXT             CHECK (endTime   IS NULL OR endTime   GLOB '[0-2][0-9]:[0-5][0-9]'),
  notes           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'dismissed')),
  completedAt     TEXT,
  createdAt       TEXT    NOT NULL,
  updatedAt       TEXT    NOT NULL,
  durationMinutes INTEGER NOT NULL DEFAULT 60
                    CHECK (typeof(durationMinutes) = 'integer' AND durationMinutes BETWEEN 5 AND 480),
  priority        TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  dueDate         TEXT             CHECK (dueDate IS NULL OR dueDate GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  isFixed         INTEGER NOT NULL DEFAULT 0 CHECK (isFixed IN (0, 1) AND (isFixed = 0 OR startTime IS NOT NULL)),
  energy          TEXT             CHECK (energy IS NULL OR energy IN ('deep', 'normal', 'light')),

  -- An end time only makes sense after a start time.
  CHECK (endTime IS NULL OR (startTime IS NOT NULL AND endTime > startTime)),
  -- completedAt is set exactly when the task is completed.
  CHECK (
    (status = 'completed' AND completedAt IS NOT NULL)
    OR
    (status <> 'completed' AND completedAt IS NULL)
  )
);

-- Every query is scoped to one owner, so ownerId leads each index.

-- Today view: WHERE ownerId = ? AND scheduledDate = ? AND status = ?
CREATE INDEX idx_tasks_owner_date_status ON tasks (ownerId, scheduledDate, status);

-- Backlog view: WHERE ownerId = ? AND status = 'open' AND scheduledDate < ?
CREATE INDEX idx_tasks_owner_status_date ON tasks (ownerId, status, scheduledDate);

-- Planning queries will look for upcoming deadlines.
CREATE INDEX idx_tasks_owner_due_date ON tasks (ownerId, dueDate) WHERE dueDate IS NOT NULL;
