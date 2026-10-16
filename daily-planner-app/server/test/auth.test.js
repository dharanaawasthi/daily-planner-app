// Clerk session protection on /api. Runs offline: real tokens are never
// needed — malformed ones fail inside Clerk's verifyToken before any network
// call, and the "valid token" cases use a stand-in verifier.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/connection.js';
import { createClerkAuth } from '../src/middleware/auth.js';
import { one } from './helpers.js';

const FAKE_SECRET = 'sk_test_not_a_real_key';

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function call(base, method, path, { token, header, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (header) headers.Authorization = header;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('API without a valid Clerk session', () => {
  let db;
  let server;
  let base;

  before(async () => {
    db = await openDatabase(':memory:');
    // The real Clerk middleware, as used in production.
    ({ server, base } = await listen(
      createApp({ db, serveClient: false, auth: createClerkAuth({ secretKey: FAKE_SECRET }) }),
    ));
  });

  after(() => {
    server.close();
    db.close();
  });

  const routes = [
    ['GET', '/api/health'],
    ['GET', '/api/tasks'],
    ['GET', '/api/tasks/today?today=2026-10-15'],
    ['GET', '/api/tasks/backlog?today=2026-10-15'],
    ['GET', '/api/tasks/1'],
    ['POST', '/api/tasks', { title: 'Sneaky', category: 'Career' }],
    ['PATCH', '/api/tasks/1', { title: 'Changed' }],
    ['POST', '/api/tasks/1/reschedule', { date: '2026-10-20' }],
    ['POST', '/api/tasks/1/dismiss'],
    ['DELETE', '/api/tasks/1'],
    ['GET', '/api/no-such-route'],
  ];

  for (const [method, path, body] of routes) {
    test(`${method} ${path} → 401 with no token`, async () => {
      const res = await call(base, method, path, { body });
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { error: 'Authentication required' });
    });
  }

  test('a malformed bearer token → 401', async () => {
    const res = await call(base, 'GET', '/api/tasks', { token: 'not-a-jwt' });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Authentication required' });
  });

  test('a non-Bearer Authorization header → 401', async () => {
    const res = await call(base, 'GET', '/api/tasks', { header: 'Basic dXNlcjpwYXNz' });
    assert.equal(res.status, 401);
  });

  test('rejected requests change nothing', async () => {
    const count = async () => (await one(db, 'SELECT COUNT(*) AS n FROM tasks')).n;
    const before = await count();
    await call(base, 'POST', '/api/tasks', { body: { title: 'Sneaky', category: 'Career' } });
    assert.equal(await count(), before);
  });
});

describe('API with a verified Clerk session', () => {
  const seen = [];
  // Stand-in for Clerk's verifyToken: accepts only "good-token".
  const verify = async (token, options) => {
    seen.push({ token, options });
    if (token !== 'good-token') throw Object.assign(new Error('bad'), { reason: 'token-invalid' });
    return { sub: 'user_abc123' };
  };

  let db;
  let server;
  let base;

  before(async () => {
    db = await openDatabase(':memory:');
    const app = express();
    // A probe route to show what handlers receive.
    app.get('/api/whoami', createClerkAuth({ secretKey: FAKE_SECRET, verify }), (req, res) => {
      res.json({ userId: req.userId });
    });
    app.use(createApp({ db, serveClient: false, auth: createClerkAuth({ secretKey: FAKE_SECRET, verify }) }));
    ({ server, base } = await listen(app));
  });

  after(() => {
    server.close();
    db.close();
  });

  test('handlers receive the Clerk user ID as req.userId', async () => {
    const res = await call(base, 'GET', '/api/whoami', { token: 'good-token' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { userId: 'user_abc123' });
  });

  test('the token and server secret key are passed to verification', async () => {
    seen.length = 0;
    await call(base, 'GET', '/api/health', { token: 'good-token' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].token, 'good-token');
    assert.equal(seen[0].options.secretKey, FAKE_SECRET);
  });

  test('existing routes behave as before', async () => {
    assert.deepEqual((await call(base, 'GET', '/api/health', { token: 'good-token' })).body, { ok: true });

    const created = await call(base, 'POST', '/api/tasks?today=2026-10-15', {
      token: 'good-token',
      body: { title: 'Signed-in task', category: 'Career' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'Signed-in task');

    const fetched = await call(base, 'GET', `/api/tasks/${created.body.id}`, { token: 'good-token' });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.id, created.body.id);
  });

  test('a token that fails verification → 401', async () => {
    const res = await call(base, 'GET', '/api/tasks', { token: 'bad-token' });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Authentication required' });
  });

  test('a verified token without a user ID → 401', async () => {
    const app = createApp({
      db,
      serveClient: false,
      auth: createClerkAuth({ secretKey: FAKE_SECRET, verify: async () => ({}) }),
    });
    const { server: s, base: b } = await listen(app);
    try {
      assert.equal((await call(b, 'GET', '/api/tasks', { token: 'whatever' })).status, 401);
    } finally {
      s.close();
    }
  });
});
