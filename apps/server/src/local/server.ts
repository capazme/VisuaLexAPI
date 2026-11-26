import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import app from '../app';
import { sessionCookieName } from '../auth/webSession';
import { SESSION_PATH, WINDOW_COOKIE, portGuard, sessionExchange, windowGuard } from './guards';
import { openWindowSession } from './profile';
import { localSources } from './sources';

/**
 * The page's policy. The window loads http://127.0.0.1, so this header is the page's only policy: the production
 * ingress's (infra/ingress/Caddyfile), enforced, plus object-src.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export interface LocalServerOptions {
  port: number;
  webDir: string;
  launchSecret: string;
  profileId: string;
  version?: string;
}

/**
 * The local server, in order: the port's checks, the shell's exchange, the window's cookie, the sources' routes, the
 * app for /api, the built web (spec §6). The window's cookie is a random value made here, once per launch.
 */
export function buildLocalServer({ port, webDir, launchSecret, profileId, version = 'local' }: LocalServerOptions): Express {
  const windowToken = crypto.randomBytes(32).toString('base64url');
  // The page for every path the web routes itself, read once: a launch without the built web fails here, and no
  // request reads the disk for it.
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'));
  const local = express();
  local.disable('x-powered-by');
  local.set('trust proxy', false);

  local.use(portGuard(port));
  local.post(SESSION_PATH, sessionExchange(launchSecret, async (userAgent) => ({
    cookies: [
      { name: WINDOW_COOKIE, value: windowToken },
      { name: sessionCookieName(), value: await openWindowSession(profileId, userAgent) },
    ],
  })));
  local.use(windowGuard(windowToken));

  local.use(localSources(version));
  // The app answers /api, as online behind the ingress; its own 404 is the last word there.
  local.use((req, res, next) => (req.path === '/api' || req.path.startsWith('/api/') ? app(req, res, next) : next()));

  local.use(express.static(webDir, {
    index: false,
    setHeaders: (res, file) => {
      res.setHeader('Content-Security-Policy', CSP);
      res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  local.get(/.*/, (_req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(indexHtml);
  });
  return local;
}
