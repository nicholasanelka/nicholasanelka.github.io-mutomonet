const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Slow down brute-force attempts on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' }
});

function signToken(user, rememberMe) {
  const expiresIn = rememberMe
    ? process.env.JWT_REMEMBER_EXPIRES_IN || '30d'
    : process.env.JWT_EXPIRES_IN || '1d';
  const token = jwt.sign(
    { id: user.id, email: user.email, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn }
  );
  const maxAgeMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return { token, maxAgeMs };
}

function setAuthCookie(res, token, maxAgeMs) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeMs
  });
}

router.post('/register', authLimiter, (req, res) => {
  const { fullName, email, phone, password } = req.body;

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 9) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);

  const result = db
    .prepare(
      'INSERT INTO users (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?)'
    )
    .run(fullName.trim(), email.toLowerCase().trim(), cleanPhone, passwordHash);

  const user = { id: result.lastInsertRowid, email: email.toLowerCase(), full_name: fullName };
  const { token, maxAgeMs } = signToken(user, false);
  setAuthCookie(res, token, maxAgeMs);

  res.status(201).json({
    message: 'Account created successfully.',
    token,
    user: { id: user.id, fullName, email: user.email, phone: cleanPhone }
  });
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const { token, maxAgeMs } = signToken(user, !!rememberMe);
  setAuthCookie(res, token, maxAgeMs);

  res.json({
    message: 'Login successful.',
    token,
    rememberMe: !!rememberMe,
    user: { id: user.id, fullName: user.full_name, email: user.email, phone: user.phone, isAdmin: !!user.is_admin }
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out.' });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, full_name, email, phone, is_admin, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

module.exports = router;
