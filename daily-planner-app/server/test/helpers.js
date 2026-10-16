// Shared test harness: an Express app on a fresh in-memory database.
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/connection.js';

export const TEST_USER_ID = 'user_test';

/** Run SQL directly (tests only) and get plain row objects back. */
export async function all(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows.map((row) => Object.fromEntries(result.columns.map((col) => [col, row[col]])));
}

/** First row of a direct SQL query, or undefined. */
export async function one(db, sql, args = []) {
  return (await all(db, sql, args))[0];
}

/**
 * Header the test clients use to pick which fake user is signed in. Only the
 * test stand-in below reads it; production auth comes from Clerk's token.
 */
const TEST_USER_HEADER = 'x-test-user';

/**
 * Stand-in for Clerk auth: the request is signed in as the user named in the
 * X-Test-User header, or TEST_USER_ID by default.
 */
export function testAuth(req, res, next) {
  req.userId = req.get(TEST_USER_HEADER) || TEST_USER_ID;
  next();
}

export async function startTestServer({ db } = {}) {
  db ??= await openDatabase(':memory:');
  const server = createApp({ db, serveClient: false, auth: testAuth }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(userId, method, path, body) {
    const headers = { [TEST_USER_HEADER]: userId };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** API client signed in as `userId`. */
  function asUser(userId) {
    return {
      get: (p) => call(userId, 'GET', p),
      post: (p, b) => call(userId, 'POST', p, b),
      patch: (p, b) => call(userId, 'PATCH', p, b),
      del: (p) => call(userId, 'DELETE', p),
    };
  }

  return {
    db,
    ...asUser(TEST_USER_ID),
    asUser,
    close() {
      server.close();
      db.close();
    },
  };
}
