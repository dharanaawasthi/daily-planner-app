-- Migration 002 — planning fields (database version 2)
--
-- Adds the data an assistant needs to plan a day. Existing rows are kept;
-- each new column gets a safe value for them:
--
--   durationMinutes  INTEGER 5–480, default 60. For existing tasks with both a
--                    start and end time it is backfilled from that time block.
--   priority         'low' | 'medium' | 'high', default 'medium'
--   dueDate          'YYYY-MM-DD' or NULL (no deadline), default NULL
--   isFixed          0/1, default 0. A fixed task can't be moved by a planner,
--                    so it must have a start time.
--   energy           'deep' | 'normal' | 'light' or NULL (not set). Existing
--                    tasks stay NULL; the API defaults NEW tasks to 'normal'.

ALTER TABLE tasks ADD COLUMN durationMinutes INTEGER NOT NULL DEFAULT 60
  CHECK (typeof(durationMinutes) = 'integer' AND durationMinutes BETWEEN 5 AND 480);

ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high'));

ALTER TABLE tasks ADD COLUMN dueDate TEXT
  CHECK (dueDate IS NULL OR dueDate GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');

ALTER TABLE tasks ADD COLUMN isFixed INTEGER NOT NULL DEFAULT 0
  CHECK (isFixed IN (0, 1) AND (isFixed = 0 OR startTime IS NOT NULL));

ALTER TABLE tasks ADD COLUMN energy TEXT
  CHECK (energy IS NULL OR energy IN ('deep', 'normal', 'light'));

-- Backfill: a task that already has a time block gets that length as its
-- duration (clamped to 5–480). updatedAt is left alone: the user didn't edit it.
UPDATE tasks
   SET durationMinutes = MIN(480, MAX(5,
         (CAST(substr(endTime, 1, 2) AS INTEGER) * 60 + CAST(substr(endTime, 4, 2) AS INTEGER))
       - (CAST(substr(startTime, 1, 2) AS INTEGER) * 60 + CAST(substr(startTime, 4, 2) AS INTEGER))))
 WHERE startTime IS NOT NULL AND endTime IS NOT NULL;

-- Planning queries will look for upcoming deadlines.
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (dueDate) WHERE dueDate IS NOT NULL;
