import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createTaskRepository } from './db/taskRepository.js';
import { HttpError } from './lib/errors.js';
import { createTasksRouter } from './routes/tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '../../client/dist');

/**
 * Build the Express app around an open database. Kept separate from
 * index.js so tests can create an app on an in-memory database.
 */
export function createApp({ db, serveClient = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // ── API ──────────────────────────────────────────────────────────────
  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/tasks', createTasksRouter(createTaskRepository(db)));

  // Unknown /api routes get a JSON 404 rather than the React app.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
  });

  // ── Built React app (production: `npm run build` then `npm start`) ────
  if (serveClient && fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  // ── Errors ───────────────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}
