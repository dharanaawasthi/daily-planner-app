import { verifyToken } from '@clerk/express';

// Reasons that mean the server itself is misconfigured (bad secret key, or
// Clerk's signing keys couldn't be fetched) rather than a bad client token.
const SERVER_SIDE_REASONS = /^(secret-key|jwk-)/;

const unauthorized = (res) => res.status(401).json({ error: 'Authentication required' });

function bearerToken(req) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Require a verified Clerk session token (`Authorization: Bearer <token>`)
 * on every request. On success the Clerk user ID is available to handlers as
 * `req.userId` — the future task owner identity. Otherwise: 401 JSON.
 *
 * Uses the official SDK's verifyToken, which needs only CLERK_SECRET_KEY
 * (clerkMiddleware() would also require a publishable key on the server).
 * `verify` exists so tests can run without contacting Clerk.
 */
export function createClerkAuth({ secretKey = process.env.CLERK_SECRET_KEY, verify = verifyToken } = {}) {
  return async (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return unauthorized(res);

    try {
      const payload = await verify(token, { secretKey });
      if (!payload?.sub) return unauthorized(res);
      req.userId = payload.sub;
      next();
    } catch (err) {
      if (SERVER_SIDE_REASONS.test(err?.reason ?? '')) {
        console.error(`Clerk token verification failed on the server (${err.reason}). Check CLERK_SECRET_KEY in server/.env.`);
      }
      unauthorized(res);
    }
  };
}
