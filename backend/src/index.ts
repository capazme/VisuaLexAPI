import { config } from './config';
import app from './app';
import { prisma } from './lib/prisma';
import { scheduleStuckJobSweeper } from './services/merlt/jobWatchdog';

// MERL-T job watchdog: callbacks worker→BFF have retry+backoff, but if they
// ever fail past that, this catches the stragglers (transitions pending/running
// rows older than 10min → 'timeout' so the polling UI unblocks). Skipped in
// tests (where the harness reset is sufficient).
let watchdogInterval: NodeJS.Timeout | null = null;
if (config.nodeEnv !== 'test') {
  watchdogInterval = scheduleStuckJobSweeper(prisma, {
    intervalMs: 5 * 60 * 1000,
    staleAfterMs: 10 * 60 * 1000,
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
