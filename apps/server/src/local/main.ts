/**
 * The desktop app's local server (G-612, spec §6): the same Express app on the encrypted local file, started by the
 * app's shell, serving the built web from the same origin.
 *
 * The contract with the shell:
 * - environment: LEXCRAFT_DATA_DIR (the data folder), LEXCRAFT_WEB_DIR (the built web), optionally LEXCRAFT_PORT
 *   (the preferred port, 47310 by default) and LEXCRAFT_SQL_DIR (the local SQL, prisma/local by default);
 * - stdin, first line: `key=<64 hex> launch=<secret>`. The database key comes from the system's keychain; the launch
 *   secret is made by the shell for this launch. Neither is ever written to a file, a log or the environment;
 * - stdout, once it listens on 127.0.0.1: `LEXCRAFT_READY port=<n> ready_ms=<t>`;
 * - the shell then calls `POST /__lexcraft/session` with `Authorization: Bearer <launch secret>` and sets the cookies
 *   it receives in the window (src/local/guards.ts);
 * - when stdin closes, however the shell ended, the server closes the database and exits.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { LAUNCH_SECRET } from './guards';

const started = process.hrtime.bigint();
const elapsedMs = (): number => Number((process.hrtime.bigint() - started) / 1_000_000n);
const PORT_TRIES = 5;

function fail(message: string): never {
  process.stderr.write(`[lexcraft] ${message}\n`);
  process.exit(1);
}

/** The stdin line's two secrets, or null when it is not exactly `key=<64 hex> launch=<secret>`. */
export function parseLaunchLine(line: string): { keyHex: string; launchSecret: string } | null {
  const match = /^key=([0-9a-f]{64}) launch=(\S+)$/.exec(line.trim());
  if (!match || !LAUNCH_SECRET.test(match[2])) return null;
  return { keyHex: match[1], launchSecret: match[2] };
}

/**
 * The server's own secrets, derived from the database key (HKDF-SHA256, one label each): stable across launches,
 * never written anywhere, and protected by the keychain as the key is. Knowing one tells nothing of the key.
 */
export function derivedSecrets(keyHex: string): { jwtSecret: string; filesKey: string } {
  const key = Buffer.from(keyHex, 'hex');
  const derive = (label: string, length: number) => Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), label, length));
  return {
    jwtSecret: derive('lexcraft-local jwt', 48).toString('base64url'),
    filesKey: derive('lexcraft-local pratica-files', 32).toString('base64'),
  };
}

function firstLine(): Promise<string> {
  return new Promise((resolve) => {
    const lines = readline.createInterface({ input: process.stdin });
    const timer = setTimeout(() => fail('no launch line on stdin within 10 s'), 10_000);
    const closed = () => fail('stdin closed before the launch line');
    lines.once('close', closed);
    lines.once('line', (line) => {
      clearTimeout(timer);
      lines.off('close', closed);
      lines.close();
      resolve(line);
    });
  });
}

/** A fixed port, so the page's origin (and its local storage) stays the same across launches; a few fallbacks. */
function listen(server: http.Server, first: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number, left: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (error.code === 'EADDRINUSE' && left > 1) attempt(port + 1, left - 1);
        else reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    };
    attempt(first, PORT_TRIES);
  });
}

async function main(): Promise<void> {
  // First of all: the configuration reads no `.env` in local mode (src/config.ts), and no source is reached.
  process.env.LEXCRAFT_MODE = 'local';
  const dataDir = path.resolve(process.env.LEXCRAFT_DATA_DIR || fail('LEXCRAFT_DATA_DIR is not set'));
  const webDir = path.resolve(process.env.LEXCRAFT_WEB_DIR || fail('LEXCRAFT_WEB_DIR is not set'));
  const sqlDir = path.resolve(process.env.LEXCRAFT_SQL_DIR || path.join(__dirname, '../../prisma/local'));
  const preferredPort = Number(process.env.LEXCRAFT_PORT || 47310);
  if (!Number.isInteger(preferredPort) || preferredPort < 1024 || preferredPort > 65535 - PORT_TRIES) fail('LEXCRAFT_PORT is not a usable port');

  const launch = parseLaunchLine(await firstLine());
  if (!launch) fail('the launch line is not `key=<64 hex> launch=<secret>`');
  // stdin stays open: its end is the shell's end, from now on, start-up included.
  let stop: ((why: string) => void) | null = null;
  const shellGone = () => {
    if (stop) return stop('stdin closed');
    process.stderr.write('[lexcraft] stopping (stdin closed during start-up)\n');
    process.exit(0);
  };
  process.stdin.once('end', shellGone);
  process.stdin.once('close', shellGone);
  process.stdin.resume();

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // The process's folder is the data folder, which only this user can write, whatever folder the shell started it in.
  process.chdir(dataDir);
  const file = path.join(dataDir, 'lexcraft.db');
  const filesDir = path.join(dataDir, 'pratica-files');
  fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });

  // One process per data folder, and the file at this build's schema, before anything else opens it.
  const { holdInstanceLock, setLocalKey } = await import('./database');
  const { migrateLocal } = await import('./migrate');
  holdInstanceLock(file);
  migrateLocal({ file, keyHex: launch.keyHex, sqlDir, backupsDir: path.join(dataDir, 'backups') });

  // The port first: the app's configuration reads its own origin when it loads.
  const server = http.createServer();
  const port = await listen(server, preferredPort);
  const origin = `http://127.0.0.1:${port}`;
  const { jwtSecret, filesKey } = derivedSecrets(launch.keyHex);
  Object.assign(process.env, {
    LEXCRAFT_MODE: 'local',
    NODE_ENV: 'production',
    DATABASE_URL: `file:${file}`,
    LEXCRAFT_DB_FILE: file,
    JWT_SECRET: jwtSecret,
    ALLOWED_ORIGINS: origin,
    SESSION_COOKIE_SECURE: 'false',
    // The window's session lasts as long as the launch: each launch ends the earlier ones (src/local/profile.ts), and
    // locally there is no sign-in to make a new one, so it must not expire while the app is open.
    SESSION_IDLE_DAYS: '3650',
    SESSION_MAX_DAYS: '3650',
    REDIS_ENABLED: 'false',
    MERLT_ENABLED: 'false',
    NORMA_WATCH_ENABLED: 'false',
    PRATICA_FILES_DIR: filesDir,
    PRATICA_FILES_KEY: filesKey,
  });
  setLocalKey(launch.keyHex);

  const { buildLocalServer } = await import('./server');
  const { prisma } = await import('../lib/prisma');
  const { ensureLocalProfile } = await import('./profile');
  const profile = await ensureLocalProfile();
  server.on('request', buildLocalServer({ port, webDir, launchSecret: launch.launchSecret, profileId: profile.id }));
  process.stdout.write(`LEXCRAFT_READY port=${port} ready_ms=${elapsedMs()}\n`);

  let stopping = false;
  stop = (why: string) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`[lexcraft] stopping (${why})\n`);
    setTimeout(() => process.exit(0), 3000).unref();
    setInterval(() => server.closeIdleConnections(), 100).unref();
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  };
  // The shell is the only owner: when it goes, however it went, stdin ends and the server goes with it (above).
  if (process.stdin.readableEnded) stop('stdin closed');
  process.on('SIGTERM', () => stop?.('SIGTERM'));
  process.on('SIGINT', () => stop?.('SIGINT'));
}

if (require.main === module) {
  main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
}
