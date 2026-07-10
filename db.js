const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'mutomonet.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  phone TEXT NOT NULL,
  merchant_request_id TEXT,
  checkout_request_id TEXT UNIQUE,
  mpesa_receipt TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed | cancelled
  result_desc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchases_checkout_id ON purchases(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
`);

// Safe migration: add is_admin to users if it doesn't exist yet (older databases won't have it).
const userColumns = db.prepare("PRAGMA table_info(users)").all();
const hasIsAdmin = userColumns.some((col) => col.name === 'is_admin');
if (!hasIsAdmin) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
