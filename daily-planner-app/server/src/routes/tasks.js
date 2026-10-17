import express from 'express';
import { isPlausibleLocalDate, isValidDate, localToday } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { NOT_DONE_STATUSES, STATUSES, hasErrors, normalizeCategory, parseTaskInput } from '../lib/validation.js';

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

/**
 * The user's calendar day for the events a request writes: their ?today if it
 * is plausible (within a day of now in UTC), otherwise the server's date. A
 * wrong device clock never blocks the action itself.
 */
function eventOptions(req) {
  const today = resolveToday(req);
  return { localDate: isPlausibleLocalDate(today) ? today : localToday() };
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
  router.get('/', async (req, res) => {
    const { status, category } = req.query;
    if (status !== undefined && !STATUSES.includes(status)) {
      throw badRequest(`Query parameter "status" must be one of: ${STATUSES.join(', ')}`);
    }
    const normalizedCategory = category === undefined ? undefined : normalizeCategory(category);
    if (category !== undefined && !normalizedCategory) {
      throw badRequest('Unknown category');
    }

    res.json(
      await repo.list(req.userId, {
        date: optionalDateQuery(req, 'date'),
        from: optionalDateQuery(req, 'from'),
        to: optionalDateQuery(req, 'to'),
        status,
        category: normalizedCategory,
      }),
    );
  });

  // GET /api/tasks/today?today=YYYY-MM-DD
  // Today's tasks, split into open (not yet done: open or started, the started
  // one first) and completed, each sorted by start time.
  router.get('/today', async (req, res) => {
    const date = resolveToday(req);
    res.json({ date, ...(await repo.forDay(req.userId, date)) });
  });

  // GET /api/tasks/backlog?today=YYYY-MM-DD
  // Not-done tasks scheduled before today (a started one first, then oldest first).
  router.get('/backlog', async (req, res) => {
    const today = resolveToday(req);
    res.json({ today, tasks: await repo.backlog(req.userId, today) });
  });

  // GET /api/tasks/:id
  router.get('/:id', async (req, res) => {
    const task = await repo.findById(req.userId, parseId(req));
    if (!task) throw notFound();
    res.json(task);
  });

  // POST /api/tasks
  router.post('/', async (req, res) => {
    const { values, errors } = parseTaskInput(req.body ?? {}, { partial: false });
    if (hasErrors(errors)) throw badRequest('Validation failed', errors);

    const task = await repo.create(
      req.userId,
      { ...values, scheduledDate: values.scheduledDate ?? resolveToday(req) },
      eventOptions(req),
    );
    res.status(201).location(`/api/tasks/${task.id}`).json(task);
  });

  // PATCH /api/tasks/:id — edit any subset of fields, including status
  // (the "complete" checkbox sends { status: "completed" } / { status: "open" };
  // unticking returns a previously started task to 'started' when it can).
  // { status: "started" } is rejected: use POST /:id/start.
  router.patch('/:id', async (req, res) => {
    const id = parseId(req);
    const { values, errors } = parseTaskInput(req.body ?? {}, { partial: true });
    if (hasErrors(errors)) throw badRequest('Validation failed', errors);

    const task = await repo.update(req.userId, id, values, eventOptions(req));
    if (!task) throw notFound();
    res.json(task);
  });

  // POST /api/tasks/:id/start — "Start" in the task sheet. Only one task per
  // user is started: any other started task goes back to open.
  router.post('/:id/start', async (req, res) => {
    const task = await repo.start(req.userId, parseId(req), eventOptions(req));
    if (!task) throw notFound();
    res.json(task);
  });

  // POST /api/tasks/:id/reschedule  { "date": "YYYY-MM-DD" }
  // Backlog actions "Schedule for today" and "Choose another date". A started
  // task may be rescheduled; it then goes back to open.
  router.post('/:id/reschedule', async (req, res) => {
    const id = parseId(req);
    const today = resolveToday(req);
    const date = req.body?.date;

    if (!isValidDate(date)) {
      throw badRequest('Validation failed', { date: 'Date must be a real date in YYYY-MM-DD format' });
    }
    if (date < today) {
      throw badRequest('Validation failed', { date: 'Choose today or a future date' });
    }

    const existing = await repo.findById(req.userId, id);
    if (!existing) throw notFound();
    if (!NOT_DONE_STATUSES.includes(existing.status)) {
      throw conflict(`Only open tasks can be rescheduled (this one is ${existing.status})`);
    }

    res.json(await repo.update(req.userId, id, { scheduledDate: date }, eventOptions(req)));
  });

  // POST /api/tasks/:id/dismiss — backlog action "Dismiss" (open or started tasks)
  router.post('/:id/dismiss', async (req, res) => {
    const id = parseId(req);
    const existing = await repo.findById(req.userId, id);
    if (!existing) throw notFound();
    if (!NOT_DONE_STATUSES.includes(existing.status)) {
      throw conflict(`Only open tasks can be dismissed (this one is ${existing.status})`);
    }

    res.json(await repo.update(req.userId, id, { status: 'dismissed' }, eventOptions(req)));
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', async (req, res) => {
    if (!(await repo.remove(req.userId, parseId(req)))) throw notFound();
    res.status(204).end();
  });

  return router;
}
