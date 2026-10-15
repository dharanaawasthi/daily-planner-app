// Shared test harness: an Express app on a fresh in-memory database.
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/connection.js';

export async function startTestServer({ db = openDatabase(':memory:') } = {}) {
  const server = createApp({ db, serveClient: false }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  return {
    db,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    close() {
      server.close();
      db.close();
    },
  };
}
