const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { initiateSTKPush, querySTKPushStatus, formatPhone } = require('../utils/mpesa');

const router = express.Router();

const PACKAGES = {
  hourly: { name: 'Hourly Plan', amount: 10 },
  daily: { name: 'Daily Plan', amount: 40 },
  weekly: { name: 'Weekly Plan', amount: 270 },
  monthly: { name: 'Monthly Plan', amount: 1000 }
};

const checkoutLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checkout attempts. Please wait a few minutes and try again.' }
});

// Kick off an automated M-Pesa STK push for the chosen package.
router.post('/checkout', requireAuth, checkoutLimiter, async (req, res) => {
  const { packageId, phone } = req.body;
  const pkg = PACKAGES[packageId];

  if (!pkg) {
    return res.status(400).json({ error: 'Unknown package selected.' });
  }
  if (!phone || !formatPhone(phone)) {
    return res.status(400).json({ error: 'Please enter a valid M-Pesa phone number (e.g. 07XXXXXXXX).' });
  }

  try {
    const stk = await initiateSTKPush({
      amount: pkg.amount,
      phone,
      accountRef: `MutomoNet`,
      description: pkg.name
    });

    db.prepare(
      `INSERT INTO purchases
        (user_id, package_name, amount, phone, merchant_request_id, checkout_request_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      req.user.id,
      pkg.name,
      pkg.amount,
      stk.formattedPhone,
      stk.MerchantRequestID,
      stk.CheckoutRequestID
    );

    res.json({
      message: 'Check your phone and enter your M-Pesa PIN to complete payment.',
      checkoutRequestId: stk.CheckoutRequestID
    });
  } catch (err) {
    console.error('STK push error:', err.message);
    res.status(err.status || 502).json({
      error: err.message || 'Could not start payment. Please try again shortly.'
    });
  }
});

// Safaricom calls this URL automatically once the customer completes (or cancels) payment.
router.post('/callback', (req, res) => {
  // Always acknowledge receipt immediately, per Daraja requirements.
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) return;

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    let receipt = null;
    if (ResultCode === 0 && CallbackMetadata?.Item) {
      const item = CallbackMetadata.Item.find((i) => i.Name === 'MpesaReceiptNumber');
      receipt = item?.Value || null;
    }

    const status = ResultCode === 0 ? 'completed' : 'failed';

    db.prepare(
      `UPDATE purchases
       SET status = ?, result_desc = ?, mpesa_receipt = ?, updated_at = datetime('now')
       WHERE checkout_request_id = ?`
    ).run(status, ResultDesc, receipt, CheckoutRequestID);
  } catch (err) {
    console.error('Error processing M-Pesa callback:', err);
  }
});

// Frontend polls this after initiating checkout to find out when payment completes.
router.get('/status/:checkoutRequestId', requireAuth, async (req, res) => {
  const purchase = db
    .prepare('SELECT * FROM purchases WHERE checkout_request_id = ? AND user_id = ?')
    .get(req.params.checkoutRequestId, req.user.id);

  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

  // If our DB still shows pending, double check directly with Safaricom in case the
  // callback hasn't arrived yet (e.g. slow network).
  if (purchase.status === 'pending') {
    try {
      const live = await querySTKPushStatus(req.params.checkoutRequestId);
      if (live.ResultCode !== undefined && String(live.ResultCode) !== '1032') {
        const status = String(live.ResultCode) === '0' ? 'completed' : 'failed';
        db.prepare(
          `UPDATE purchases SET status = ?, result_desc = ?, updated_at = datetime('now')
           WHERE checkout_request_id = ?`
        ).run(status, live.ResultDesc, req.params.checkoutRequestId);
        purchase.status = status;
        purchase.result_desc = live.ResultDesc;
      }
    } catch (_err) {
      // Ignore — we'll just report current DB state and let the client keep polling.
    }
  }

  res.json({ purchase });
});

// A user's purchase history
router.get('/history', requireAuth, (req, res) => {
  const purchases = db
    .prepare('SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({ purchases });
});

module.exports = router;
