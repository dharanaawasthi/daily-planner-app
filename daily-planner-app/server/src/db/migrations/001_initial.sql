-- Migration 001 — initial schema (database version 1)
--
-- Migrations are never edited after release: later changes go in new files
-- (002_..., 003_...) so existing databases upgrade step by step.
--
-- Dates are stored as 'YYYY-MM-DD' text and times as 'HH:MM' (24h) text.
-- Both formats sort correctly as plain strings, so ORDER BY and the backlog
-- comparison (scheduledDate < today) work without any date functions.
--
-- "Backlog" is NOT a status. A task is in the backlog when:
--     status = 'open' AND scheduledDate < today

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  category      TEXT    NOT NULL CHECK (category IN ('Study', 'Gym', 'Career', 'Personal')),
  scheduledDate TEXT    NOT NULL CHECK (scheduledDate GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  startTime     TEXT             CHECK (startTime IS NULL OR startTime GLOB '[0-2][0-9]:[0-5][0-9]'),
  endTime       TEXT             CHECK (endTime   IS NULL OR endTime   GLOB '[0-2][0-9]:[0-5][0-9]'),
  notes         TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'dismissed')),
  completedAt   TEXT,
  createdAt     TEXT    NOT NULL,
  updatedAt     TEXT    NOT NULL,

  -- An end time only makes sense after a start time.
  CHECK (endTime IS NULL OR (startTime IS NOT NULL AND endTime > startTime)),
  -- completedAt is set exactly when the task is completed.
  CHECK (
    (status = 'completed' AND completedAt IS NOT NULL)
    OR
    (status <> 'completed' AND completedAt IS NULL)
  )
);

-- Today view: WHERE scheduledDate = ? AND status = ?
CREATE INDEX IF NOT EXISTS idx_tasks_date_status ON tasks (scheduledDate, status);

-- Backlog view: WHERE status = 'open' AND scheduledDate < ?
CREATE INDEX IF NOT EXISTS idx_tasks_status_date ON tasks (status, scheduledDate);
