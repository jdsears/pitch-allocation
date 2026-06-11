const crypto = require('crypto');

/**
 * Lightweight shared-password auth for admin actions.
 *
 * Set ADMIN_PASSWORD in the environment. POST /api/auth/login exchanges the
 * password for a stateless token (HMAC of a fixed string keyed by the
 * password), which the client sends as `Authorization: Bearer <token>`.
 *
 * If ADMIN_PASSWORD is not set, auth is DISABLED (everything allowed) so an
 * existing deployment keeps working until the env var is added — a warning
 * is logged on boot. Referee claiming and the public request form are never
 * gated; only admin mutations use requireAdmin.
 */

const PASSWORD = process.env.ADMIN_PASSWORD || null;

function expectedToken() {
  if (!PASSWORD) return null;
  return crypto.createHmac('sha256', PASSWORD).update('morley-admin-v1').digest('hex');
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authEnabled() {
  return !!PASSWORD;
}

/** Express middleware: require a valid admin token (no-op if auth disabled). */
function requireAdmin(req, res, next) {
  if (!PASSWORD) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token && timingSafeEqual(token, expectedToken())) return next();
  return res.status(401).json({ error: 'Admin login required' });
}

/** Exchange the admin password for a token. Returns null on wrong password. */
function login(password) {
  if (!PASSWORD) return null;
  if (!timingSafeEqual(password || '', PASSWORD)) return null;
  return expectedToken();
}

/** Is the given bearer token currently valid? */
function verifyToken(token) {
  if (!PASSWORD) return true;
  return !!token && timingSafeEqual(token, expectedToken());
}

/** Express middleware: gate every non-GET method behind admin auth. */
function requireAdminForMutations(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return requireAdmin(req, res, next);
}

if (!PASSWORD) {
  console.warn('ADMIN_PASSWORD not set — admin routes are UNPROTECTED. Set it in the environment to enable login.');
}

module.exports = { requireAdmin, requireAdminForMutations, login, verifyToken, authEnabled };
