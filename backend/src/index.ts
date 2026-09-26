import { config } from './config';
import app from './app';
import { prisma } from './lib/prisma';
import { startNormaWatcher } from './utils/normaWatcher';

let normaWatcherInterval: NodeJS.Timeout | null = null;

const server = app.listen(config.port, () => {
  normaWatcherInterval = startNormaWatcher();
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

// Graceful shutdown: stop the saved-norm watcher, drain in-flight requests,
// release the Prisma connection pool, then exit. Idempotent across repeated
// signals. A watcher run already under way is cut short, which is safe: each
// of its writes is atomic, and the next run starts again from the least
// recently seen watch.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing server...`);
  if (normaWatcherInterval) clearInterval(normaWatcherInterval);
  server.close(() => {
    prisma
      .$disconnect()
      .catch((err) => console.error('[shutdown] prisma disconnect failed:', err))
      .finally(() => process.exit(0));
  });
  // close() drops the idle keep-alive sockets only once. A socket that was
  // mid-request stays open for the whole keep-alive timeout (~6 s) after its
  // answer, past the 1.6 s pm2 waits by default before its SIGKILL: drop each
  // one as soon as it goes idle.
  setInterval(() => server.closeIdleConnections(), 100).unref();
  // Handling the signal replaces Node's own exit and repeats are ignored, so a
  // request or a disconnect that never ends must not keep the process alive.
  setTimeout(() => {
    console.error('[shutdown] still running after 10 s, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
