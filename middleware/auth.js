const jwt = require('jsonwebtoken');

/**
 * Reads the JWT from either the httpOnly cookie ("token") or an
 * Authorization: Bearer <token> header, verifies it, and attaches
 * the decoded payload to req.user.
 */
function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.token || bearer;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

// Same as requireAuth but does not fail the request if no/invalid token is present.
function optionalAuth(req, _res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.token || bearer;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_err) {
      req.user = null;
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };

// Attach requireAdmin lazily to avoid a circular require with db.js at module load time.
const db = require('../db');

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

module.exports.requireAdmin = requireAdmin;
