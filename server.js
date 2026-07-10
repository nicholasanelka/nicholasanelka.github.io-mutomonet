require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin / server-to-server calls (no origin header) and whitelisted origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  })
);

// General API rate limit as a safety net
app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mutomo Net backend running on port ${PORT}`);
});
