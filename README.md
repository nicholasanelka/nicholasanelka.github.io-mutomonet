# Mutomo Net — Website + Backend

This package has two parts:

```
frontend-mutomo-net.html   → your website (upload/host this)
backend/                   → Node.js API: real login, real signup, automated M-Pesa checkout
```

## What changed from the old version

- **Login is real now.** Passwords are hashed (bcrypt) and stored in a database, not just checked with an `alert()`.
- **Added account creation** (there was no way to actually register before).
- **"Remember Me" actually works.** Checked → you stay logged in for 30 days. Unchecked → 1 day. This is enforced server-side via a secure httpOnly cookie, not just a checkbox that did nothing.
- **All "Buy Now" buttons now trigger automated M-Pesa checkout (STK Push)** instead of opening WhatsApp. The customer enters their phone number, gets a PIN prompt automatically, and their package activates the moment Safaricom confirms payment — no manual transaction codes, no waiting on WhatsApp.
- The M-Pesa **Business Number placeholder (`XXXXXXXX`) was left exactly as you asked** — replace that text yourself when ready. Note: automated checkout still needs its own separate Shortcode + Passkey from Safaricom Daraja (explained below) — that's what actually drives the STK push, independent of the number shown on the page.
- WhatsApp is now only used for genuine support questions (forgot password, general help), not purchases.

## Bugs fixed

1. Login/payment forms did nothing real — now call actual API endpoints.
2. No way to create an account — added a Create Account tab.
3. "Remember Me" checkbox had no effect — now controls session length.
4. Password fields were missing `autocomplete` attributes (browser/password-manager issue).
5. No loading/error states on forms — buttons now show a spinner and disable while a request is in flight, and show clear success/error messages.
6. No phone number validation for M-Pesa checkout — invalid numbers are rejected before hitting the API.
7. No rate limiting — login, registration, and checkout are now rate-limited to block brute-force/abuse.
8. Nav didn't reflect whether you were logged in — it now shows "Hi, [name]" + Logout when signed in.

## 1. Backend setup

You need Node.js **22.5 or newer** on a server (a small VPS, Render, Railway, etc. all work). This project uses Node's built-in SQLite support, so there's nothing extra to compile or install for the database — just plain `npm install`.

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

- `JWT_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `CORS_ORIGIN` — the URL(s) your website will be served from.
- `PUBLIC_BASE_URL` — the public HTTPS URL of this backend itself (Safaricom needs to be able to reach `PUBLIC_BASE_URL/api/payment/callback`). For local testing, use a tunnel like `ngrok http 4000` and put the ngrok URL here.

### Getting M-Pesa (Daraja) credentials

1. Create a free account at https://developer.safaricom.co.ke
2. Create an app under "My Apps" → copy the **Consumer Key** and **Consumer Secret** into `.env`.
3. For real (production) payments, apply for **Lipa Na M-Pesa Online** and get your own **Shortcode** and **Passkey** — put those in `MPESA_SHORTCODE` and `MPESA_PASSKEY`, and set `MPESA_ENV=production`.
4. Until then, the `.env.example` ships with Safaricom's public **sandbox** shortcode/passkey so you can test the whole flow with fake money first.

Start it:

```bash
npm start
```

The API will be live at `http://localhost:4000` (or whatever `PORT` you set).

## 2. Frontend setup

Open `frontend-mutomo-net.html` and find this line near the top of the `<script>` block:

```js
const API_BASE_URL = window.MUTOMO_API_BASE_URL || "http://localhost:4000";
```

Change `"http://localhost:4000"` to wherever you deploy the backend (e.g. `"https://api.mutomonet.co.ke"`). Then upload the HTML file to your web host as usual.

## 3. How the automated checkout works

1. Customer logs in / creates an account.
2. Picks a package and enters their M-Pesa number, clicks **Pay Now**.
3. Backend calls Safaricom's STK Push API — customer instantly gets a PIN prompt on their phone.
4. Safaricom calls your backend's `/api/payment/callback` once the customer pays (or cancels).
5. The website polls `/api/payment/status/:id` every 3 seconds and shows "Payment confirmed" the moment it's done — the package is marked active in the database automatically.

## 4. Data storage

User accounts and purchase history are stored in a local SQLite file: `backend/mutomonet.sqlite`. Back this file up regularly. For heavier traffic later, this can be swapped for PostgreSQL/MySQL without changing the frontend.

## Notes / next steps you may want later

- Hook up an SMS/email flow to actually notify customers once their package activates (currently shown only on the website).
- Add a real "Forgot password" reset flow (currently routes to WhatsApp support).
- Add an admin view to see all purchases/revenue.
