import { config } from './config';
import app from './app';
import { prisma } from './lib/prisma';
import {
  scheduleStuckJobSweeper,
  DEFAULT_EXTRACT_STALE_AFTER_MS,
  DEFAULT_INGEST_STALE_AFTER_MS,
} from './services/merlt/jobWatchdog';

/** Positive integer from env, or the default (also on garbage input). */
function envMs(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// MERL-T job watchdog: callbacks worker→BFF have retry+backoff, but if they
// ever fail past that, this catches the stragglers (transitions pending/running
// rows older than their net → 'timeout' so the polling UI unblocks: 10min for
// ingestion, 45min for note extraction, 20min of silence for Q&A). Skipped in
// tests (where the harness reset is sufficient).
//
// The async progressive Q&A jobs (qa-async-progressive-contract.md) get a
// separate, higher threshold swept on liveness (`updatedAt`, bumped by every
// per-expert callback) rather than age-since-submit — a heavy ReAct
// deliberation legitimately runs up to ~11min, and sweeping on `createdAt`
// alone would flip a live, still-progressing query to `timeout` right before
// its real `completed` callback arrives (discarding a successful result).
let watchdogInterval: NodeJS.Timeout | null = null;
if (config.nodeEnv !== 'test') {
  watchdogInterval = scheduleStuckJobSweeper(prisma, {
    intervalMs: 5 * 60 * 1000,
    // Ingestion net (also lazyIngest's stale flip) and the longer extraction
    // net: MERLT_EXTRACT_STALE_MS must stay above the RQ job timeout
    // (MERLT_EXTRACT_JOB_TIMEOUT, 1800s) plus queue wait and sweep interval.
    staleAfterMs: envMs('MERLT_INGEST_STALE_MS', DEFAULT_INGEST_STALE_AFTER_MS),
    extractStaleAfterMs: envMs('MERLT_EXTRACT_STALE_MS', DEFAULT_EXTRACT_STALE_AFTER_MS),
    qaStaleAfterMs: envMs('MERLT_QA_STALE_MS', 20 * 60 * 1000),
    qaRetentionDays: envMs('MERLT_QA_RETENTION_DAYS', 30),
  });
}

const server = app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║  VisuaLex Platform Backend                               ║
║                                                           ║
║  Status: Running                                          ║
║  Port: ${config.port}                                             ║
║  Environment: ${config.nodeEnv}                            ║
║                                                           ║
║  API Endpoints:                                           ║
║  - Health: http://localhost:${config.port}/api/health            ║
║  - Auth: http://localhost:${config.port}/api/auth/*              ║
║  - Admin: http://localhost:${config.port}/api/admin/*            ║
║  - Folders: http://localhost:${config.port}/api/folders/*        ║
║  - Bookmarks: http://localhost:${config.port}/api/bookmarks/*    ║
║  - Highlights: http://localhost:${config.port}/api/highlights/*  ║
║  - Annotations: http://localhost:${config.port}/api/annotations/*║
║  - Feedback: http://localhost:${config.port}/api/feedback/*      ║
║  - History: http://localhost:${config.port}/api/history/*        ║
║  - Bulletin: http://localhost:${config.port}/api/shared-environments/*║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown: stop the watchdog, drain in-flight requests, release the
// Prisma connection pool, then exit. Idempotent across repeated signals.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing server...`);
  if (watchdogInterval) clearInterval(watchdogInterval);
  server.close(() => {
    prisma
      .$disconnect()
      .catch((err) => console.error('[shutdown] prisma disconnect failed:', err))
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
