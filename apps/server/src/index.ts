import { config } from './config';
import app from './app';
import { prisma } from './lib/prisma';
import { startNormaWatcher } from './utils/normaWatcher';
import { startDeadLetterSweeper } from './services/merlt/deadLetterLog';
import { startMerltErasureWorker } from './services/merlt/userData';
import { startCommunitySweeper } from './forum/sweep';
import { installProcessGuards } from './utils/processGuards';
import { describeUnexpectedError } from './middleware/errorHandler';
import { cookieSecure } from './auth/webSession';
import {
  scheduleStuckJobSweeper,
  DEFAULT_EXTRACT_STALE_AFTER_MS,
  DEFAULT_INGEST_STALE_AFTER_MS,
} from './services/merlt/jobWatchdog';

// The online server's entry: its background jobs (the norm watcher, the MERL-T sweepers, the Forum's) belong online.
// The desktop app's local mode starts from src/local/main.ts instead.
if (process.env.LEXCRAFT_MODE === 'local') throw new Error('[local] the local mode starts from src/local/main.ts, not src/index.ts');

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

let normaWatcherInterval: NodeJS.Timeout | null = null;
// The MERL-T dead letters expire (services/merlt/deadLetterLog.ts).
const deadLetterSweeper: NodeJS.Timeout | null =
  config.nodeEnv !== 'test' ? startDeadLetterSweeper() : null;
// Erasures MERL-T has not confirmed yet are retried (services/merlt/userData.ts).
const merltErasureWorker: NodeJS.Timeout | null =
  config.nodeEnv !== 'test' ? startMerltErasureWorker() : null;
// The Forum's terms (copies of reported texts, details and notes of closed reports, read notifications)
// hold even when nobody writes there (forum/sweep.ts).
const stopCommunitySweeper: (() => void) | null =
  config.nodeEnv !== 'test' ? startCommunitySweeper() : null;

const server = app.listen(config.port, () => {
  normaWatcherInterval = startNormaWatcher();
  if (!cookieSecure()) {
    // A.1, «Plain HTTP»: right on localhost and in the private phase over plain HTTP, wrong behind HTTPS.
    console.warn(`[webSession] the session cookie is not Secure (first allowed origin: ${config.cors.origins[0] ?? 'none'}; SESSION_COOKIE_SECURE overrides)`);
  }
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

// Graceful shutdown: stop the MERL-T watchdog, the saved-norm watcher and the
// dead-letter sweeper,
// drain in-flight requests, release the Prisma connection pool, then exit.
// Idempotent across repeated signals. A watcher run already under way is cut
// short, which is safe: each of its writes is atomic, and the next run starts
// again from the least recently seen watch.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals | 'uncaughtException', exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing server...`);
  if (watchdogInterval) clearInterval(watchdogInterval);
  if (normaWatcherInterval) clearInterval(normaWatcherInterval);
  if (deadLetterSweeper) clearInterval(deadLetterSweeper);
  if (merltErasureWorker) clearInterval(merltErasureWorker);
  stopCommunitySweeper?.();
  server.close(() => {
    prisma
      .$disconnect()
      .catch((err) => console.error(`[shutdown] prisma disconnect failed: ${describeUnexpectedError(err)}`))
      .finally(() => process.exit(exitCode));
  });
  // close() drops the idle keep-alive sockets only once. A socket that was
  // mid-request stays open for the whole keep-alive timeout (~6 s) after its
  // answer: drop each one as soon as it goes idle.
  setInterval(() => server.closeIdleConnections(), 100).unref();
  // Handling the signal replaces Node's own exit and repeats are ignored, so a
  // request or a disconnect that never ends must not keep the process alive.
  setTimeout(() => {
    console.error('[shutdown] still running after 10 s, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// An error nobody caught no longer ends the server for everyone (utils/processGuards.ts).
installProcessGuards(() => shutdown('uncaughtException', 1));
