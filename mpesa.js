const fetch = require('node-fetch');

const BASE_URL =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

let cachedToken = null;
let cachedTokenExpiry = 0;

/**
 * Formats a Kenyan phone number into the 2547XXXXXXXX / 2541XXXXXXXX
 * format required by Daraja. Accepts 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX,
 * +2547XXXXXXXX or 7XXXXXXXX.
 */
function formatPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1);
  if (digits.length === 9) return '254' + digits;
  return null; // invalid
}

function timestampNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');

  const resp = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to get M-Pesa access token: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  // Tokens last ~1hr; refresh a little early
  cachedTokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

/**
 * Initiates an STK Push (automated checkout prompt on the customer's phone).
 * amount: integer KSh
 * phone: raw phone number (will be normalized)
 * accountRef / description: shown to the customer
 */
async function initiateSTKPush({ amount, phone, accountRef, description }) {
  const formattedPhone = formatPhone(phone);
  if (!formattedPhone) {
    const err = new Error('Invalid phone number. Use format 07XXXXXXXX.');
    err.status = 400;
    throw err;
  }

  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const timestamp = timestampNow();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: formattedPhone,
    PartyB: shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: `${process.env.PUBLIC_BASE_URL}/api/payment/callback`,
    AccountReference: accountRef.slice(0, 12),
    TransactionDesc: description.slice(0, 13)
  };

  const resp = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();
  if (!resp.ok || data.errorCode) {
    const message = data.errorMessage || data.ResponseDescription || 'STK push failed';
    const err = new Error(message);
    err.status = 502;
    throw err;
  }

  return { ...data, formattedPhone };
}

async function querySTKPushStatus(checkoutRequestId) {
  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const timestamp = timestampNow();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const resp = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    })
  });

  return resp.json();
}

module.exports = { formatPhone, getAccessToken, initiateSTKPush, querySTKPushStatus };
