console.log('Starting server...');
require('dotenv').config();
console.log('dotenv loaded');
const express = require('express');
console.log('express loaded');
const cors = require('cors');
console.log('cors loaded');
const helmet = require('helmet');
console.log('helmet loaded');

const generateRoute = require('./routes/generate');
console.log('generateRoute loaded');

const app = express();
const PORT = process.env.PORT || 3000;
console.log(`PORT = ${PORT}`);

// ── Security middleware ──────────────────────────────────────
// JSON-only API — no HTML is served here, so helmet's default CSP is fine.
app.use(helmet());
console.log('helmet middleware registered');
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  credentials: true,
}));
console.log('cors middleware registered');
app.use(express.json({ limit: '16kb' }));
console.log('json middleware registered');

// ── API routes ───────────────────────────────────────────────
app.use('/api', generateRoute);
console.log('API routes registered');

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 fallback ─────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

console.log('Calling app.listen...');
app.listen(PORT, () => {
  console.log(`NarrateAI running at http://localhost:${PORT}`);
});

module.exports = app;
