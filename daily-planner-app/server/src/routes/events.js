import express from 'express';
import { CLIENT_EVENT_TYPES } from '../db/events.js';
import { isPlausibleLocalDate } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';

/**
 * The browser reports exactly one thing itself: that the app was opened.
 * Every task event is written by the server alongside the change it
 * describes, so it can't be faked or sent twice from the client.
 */
export function createEventsRouter(events) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (typeof req.userId !== 'string' || !req.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  });

  // POST /api/events  { "type": "app_opened", "date": "YYYY-MM-DD" }
  // `date` is the user's own "today". Stored at most once per user per day:
  // 201 { recorded: true } the first time, 200 { recorded: false } after.
  //
  // Best-effort by design: a storage failure is logged here and answered with
  // 500, and the client ignores it, so opening the app never breaks.
  router.post('/', async (req, res) => {
    const { type, date } = req.body ?? {};
    const errors = {};
    if (!CLIENT_EVENT_TYPES.includes(type)) errors.type = `Type must be one of: ${CLIENT_EVENT_TYPES.join(', ')}`;
    if (!isPlausibleLocalDate(date)) errors.date = "Date must be today's date in YYYY-MM-DD format";
    if (Object.keys(errors).length) throw badRequest('Validation failed', errors);

    let recorded;
    try {
      recorded = await events.recordAppOpened(req.userId, date);
    } catch (err) {
      console.error('Could not record app_opened:', err);
      return res.status(500).json({ error: 'Could not record the event' });
    }
    res.status(recorded ? 201 : 200).json({ recorded });
  });

  return router;
}
