process.env.NODE_DEBUG = ''; // suppress follow-redirects/http internal noise
console.log('[load] worker.js start');
require('dotenv').config();
const { Queue, Worker } = require('bullmq');
const { runPipeline }   = require('../pipeline');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

function parseRedisUrl(url) {
  const u = new URL(url);
  const tls = url.startsWith('rediss://');
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(tls ? { tls: { rejectUnauthorized: false } } : {}),
    maxRetriesPerRequest: null,
  };
}

const connection = parseRedisUrl(REDIS_URL);

// ── Lazy Queue ────────────────────────────────────────────────

let _queue = null;

function getQueue() {
  if (_queue) return _queue;
  console.log(`[worker] Creating BullMQ Queue — connecting to Redis at ${REDIS_URL}`);
  _queue = new Queue('video-generation', { connection });
  _queue.on('error', (err) => console.error('[worker] Queue error:', err));
  return _queue;
}

// ── Graceful shutdown ─────────────────────────────────────────

async function shutdown() {
  console.log('[worker] Shutting down…');
  if (_queue) await _queue.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

module.exports = { getQueue };

// ── Worker (only when run directly) ──────────────────────────

if (require.main === module) {
  // Lazy-load db to avoid requiring Supabase during server startup
  const { updateVideoRecord } = require('../services/db');

  const maskedHost = connection.host.slice(0, 10);
  const tlsEnabled = !!connection.tls;
  console.log(`[worker] Listening on queue 'video-generation' → Redis ${maskedHost}... (TLS: ${tlsEnabled})`);
  console.log('[worker] Starting BullMQ Worker…');

  const worker = new Worker(
    'video-generation',
    async (job) => {
      const { hook, niche, voice, captionStyle, style, musicMood, format, videoLength, preGeneratedNarration, preGeneratedBeats } = job.data;
      console.log(`[worker] Job ${job.id} started — niche: ${niche}`);
      const result = await runPipeline(
        {
          hook,
          niche,
          format:                format        || 'quote_drop',
          voice,
          captionStyle:          captionStyle  || style || 'clean',
          musicMood:             musicMood      || 'dark',
          videoLength:           videoLength    || null,
          preGeneratedNarration: preGeneratedNarration || null,
          preGeneratedBeats:     preGeneratedBeats     || null,
        },
        job
      );
      console.log(`[worker] Job ${job.id} finished`);
      return result;
    },
    { connection, concurrency: 5 }
  );

  worker.on('ready', () =>
    console.log('[worker] Connected to Redis — listening for jobs'));

  worker.on('completed', async (job, result) => {
    console.log(`[worker] ✓ Job ${job.id} — videoUrl: ${result?.videoUrl ?? 'pending'}`);
    await updateVideoRecord(job.id, {
      status:    'completed',
      video_url: result?.videoUrl ?? null,
    }).catch(err => console.error('[worker] updateVideoRecord(completed) failed:', err.message));
  });

  worker.on('failed', async (job, err) => {
    const status = err.response?.status ?? null;
    const url    = err.config?.url ?? err.response?.config?.url ?? null;
    console.error(`[worker] ✗ Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
    if (status) console.error(`[worker]   HTTP ${status}${url ? ` — ${url}` : ''}`);
    console.error(`[worker]   stack: ${err.stack}`);
    await updateVideoRecord(job.id, { status: 'failed' })
      .catch(e => console.error('[worker] updateVideoRecord(failed) failed:', e.message));
  });

  worker.on('error', (err) => console.error('[worker] Worker error:', err));

  console.log('[worker] Listening for jobs — press Ctrl+C to stop');
}
