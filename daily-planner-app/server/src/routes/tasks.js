import express from 'express';
import { isValidDate, localToday } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { STATUSES, hasErrors, normalizeCategory, parseTaskInput } from '../lib/validation.js';

/**
 * "Today" comes from the client (?today=YYYY-MM-DD) so the backlog rule
 * follows the user's time zone. If omitted, the server's local date is used.
 */
function resolveToday(req) {
  const { today } = req.query;
  if (today === undefined) return localToday();
  if (!isValidDate(today)) throw badRequest('Query parameter "today" must be a date in YYYY-MM-DD format');
  return today;
}

function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

function optionalDateQuery(req, name) {
  const value = req.query[name];
  if (value === undefined || value === '') return undefined;
  if (!isValidDate(value)) throw badRequest(`Query parameter "${name}" must be a date in YYYY-MM-DD format`);
  return value;
}

export function createTasksRouter(repo) {
  const router = express.Router();

  // Every task belongs to the signed-in user. The owner comes only from the
  // verified session (req.userId, set by the auth middleware) — never from the
  // request body or query. A task owned by someone else gets the same 404 as
  // one that doesn't exist, so ownership is never revealed.
  router.use((req, res, next) => {
    if (typeof req.userId !== 'string' || !req.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  });

  // GET /api/tasks?date=&from=&to=&status=&category=
  router.get('/', (req, res) => {
    const { status, category } = req.query;
    if (status !== undefined && !STATUSES.includes(status)) {
      throw badRequest(`Query parameter "status" must be one of: ${STATUSES.join(', ')}`);
    }
    const normalizedCategory = category === undefined ? undefined : normalizeCategory(category);
    if (category !== undefined && !normalizedCategory) {
      throw badRequest('Unknown category');
    }

    res.json(
      repo.list(req.userId, {
        date: optionalDateQuery(req, 'date'),
        from: optionalDateQuery(req, 'from'),
        to: optionalDateQuery(req, 'to'),
        status,
        category: normalizedCategory,
      }),
    );
  });

  // GET /api/tasks/today?today=YYYY-MM-DD
  // Today's tasks, split into open and completed, each sorted by start time.
  router.get('/today', (req, res) => {
    const date = resolveToday(req);
    res.json({ date, ...repo.forDay(req.userId, date) });
  });

  // GET /api/tasks/backlog?today=YYYY-MM-DD
  // Open tasks scheduled before today (oldest first).
  router.get('/backlog', (req, res) => {
    const today = resolveToday(req);
    res.json({ today, tasks: repo.backlog(req.userId, today) });
  });

  // GET /api/tasks/:id
  router.get('/:id', (req, res) => {
    const task = repo.findById(req.userId, parseId(req));
    if (!task) throw notFound();
    res.json(task);
  });

  // POST /api/tasks
  router.post('/', (req, res) => {
    const { values, errors } = parseTaskInput(req.body ?? {}, { partial: false });
    if (hasErrors(errors)) throw badRequest('Validation failed', errors);

    const task = repo.create(req.userId, {
      ...values,
      scheduledDate: values.scheduledDate ?? resolveToday(req),
    });
    res.status(201).location(`/api/tasks/${task.id}`).json(task);
  });

  // PATCH /api/tasks/:id — edit any subset of fields, including status
  // (the "complete" checkbox sends { status: "completed" } / { status: "open" }).
  router.patch('/:id', (req, res) => {
    const id = parseId(req);
    const { values, errors } = parseTaskInput(req.body ?? {}, { partial: true });
    if (hasErrors(errors)) throw badRequest('Validation failed', errors);

    const task = repo.update(req.userId, id, values);
    if (!task) throw notFound();
    res.json(task);
  });

  // POST /api/tasks/:id/reschedule  { "date": "YYYY-MM-DD" }
  // Backlog actions "Schedule for today" and "Choose another date".
  router.post('/:id/reschedule', (req, res) => {
    const id = parseId(req);
    const today = resolveToday(req);
    const date = req.body?.date;

    if (!isValidDate(date)) {
      throw badRequest('Validation failed', { date: 'Date must be a real date in YYYY-MM-DD format' });
    }
    if (date < today) {
      throw badRequest('Validation failed', { date: 'Choose today or a future date' });
    }

    const existing = repo.findById(req.userId, id);
    if (!existing) throw notFound();
    if (existing.status !== 'open') throw conflict(`Only open tasks can be rescheduled (this one is ${existing.status})`);

    res.json(repo.update(req.userId, id, { scheduledDate: date }));
  });

  // POST /api/tasks/:id/dismiss — backlog action "Dismiss"
  router.post('/:id/dismiss', (req, res) => {
    const id = parseId(req);
    const existing = repo.findById(req.userId, id);
    if (!existing) throw notFound();
    if (existing.status !== 'open') throw conflict(`Only open tasks can be dismissed (this one is ${existing.status})`);

    res.json(repo.update(req.userId, id, { status: 'dismissed' }));
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', (req, res) => {
    if (!repo.remove(req.userId, parseId(req))) throw notFound();
    res.status(204).end();
  });

  return router;
}
