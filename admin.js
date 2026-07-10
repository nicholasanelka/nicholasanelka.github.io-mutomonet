const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All routes below require a logged-in admin.
router.use(requireAdmin);

// ---------- Dashboard summary ----------
router.get('/stats', (req, res) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS totalPurchases,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS totalRevenue,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedCount,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
       FROM purchases`
    )
    .get();

  const todayRevenue = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM purchases
       WHERE status = 'completed' AND date(created_at) = date('now')`
    )
    .get();

  const last7DaysRevenue = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM purchases
       WHERE status = 'completed' AND created_at >= datetime('now', '-7 days')`
    )
    .get();

  const last30DaysRevenue = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM purchases
       WHERE status = 'completed' AND created_at >= datetime('now', '-30 days')`
    )
    .get();

  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get();

  const byPackage = db
    .prepare(
      `SELECT package_name, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS revenue
       FROM purchases WHERE status = 'completed'
       GROUP BY package_name ORDER BY revenue DESC`
    )
    .all();

  res.json({
    totalPurchases: totals.totalPurchases,
    totalRevenue: totals.totalRevenue,
    pendingCount: totals.pendingCount,
    completedCount: totals.completedCount,
    failedCount: totals.failedCount,
    todayRevenue: todayRevenue.total,
    last7DaysRevenue: last7DaysRevenue.total,
    last30DaysRevenue: last30DaysRevenue.total,
    totalUsers: totalUsers.count,
    byPackage
  });
});

// ---------- Purchases list (filterable, searchable, paginated) ----------
router.get('/purchases', (req, res) => {
  const { status, search, from, to, page = 1, pageSize = 25 } = req.query;

  const conditions = [];
  const params = [];

  if (status && ['pending', 'completed', 'failed', 'cancelled'].includes(status)) {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR p.phone LIKE ? OR p.mpesa_receipt LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (from) {
    conditions.push('date(p.created_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    conditions.push('date(p.created_at) <= date(?)');
    params.push(to);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const purchases = db
    .prepare(
      `SELECT p.*, u.full_name AS customer_name, u.email AS customer_email
       FROM purchases p
       JOIN users u ON u.id = p.user_id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM purchases p JOIN users u ON u.id = p.user_id ${whereClause}`
    )
    .get(...params);

  res.json({ purchases, total: totalRow.count, page: Number(page), pageSize: limit });
});

// ---------- Manually override a purchase status (e.g. payment issue support cases) ----------
router.patch('/purchases/:id', (req, res) => {
  const { status, note } = req.body;
  const allowed = ['pending', 'completed', 'failed', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
  }

  const purchase = db.prepare('SELECT id FROM purchases WHERE id = ?').get(req.params.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

  db.prepare(
    `UPDATE purchases SET status = ?, result_desc = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, note || `Manually set to ${status} by admin`, req.params.id);

  res.json({ message: 'Purchase updated.' });
});

// ---------- Customers list ----------
router.get('/users', (req, res) => {
  const { search, page = 1, pageSize = 25 } = req.query;
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const users = db
    .prepare(
      `SELECT id, full_name, email, phone, is_admin, created_at,
         (SELECT COUNT(*) FROM purchases WHERE user_id = users.id AND status = 'completed') AS completedPurchases,
         (SELECT COALESCE(SUM(amount), 0) FROM purchases WHERE user_id = users.id AND status = 'completed') AS totalSpent
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM users ${whereClause}`).get(...params);

  res.json({ users, total: totalRow.count, page: Number(page), pageSize: limit });
});

module.exports = router;
