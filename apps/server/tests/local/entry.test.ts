import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { connect } from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SESSION_PATH, WINDOW_COOKIE } from '../../src/local/guards';
import { ONLINE_COPY, SIGN_IN_COPY } from '../../src/local/online';
import { NETWORK_COPY } from '../../src/local/sources';
import { call, cookieHeader } from './http';

/**
 * The local entry point as the shell starts it (spec §6): a child process on a temporary data folder, its secrets on
 * stdin, its READY line on stdout, its end when stdin closes.
 */
const SERVER = path.resolve(__dirname, '../..');
const TSX = path.join(SERVER, 'node_modules/tsx/dist/cli.mjs');
const MAIN = path.join(SERVER, 'src/local/main.ts');
const TSCONFIG = path.join(SERVER, 'tsconfig.json');

/** The few variables a process needs to run at all; the entry point sets the rest itself. */
function baseEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA'];
  return Object.fromEntries(keep.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
}

interface Launch {
  dataDir: string;
  webDir: string;
  keyHex: string;
  launchSecret: string;
  port: number;
}

function newLaunch(): Launch {
  const root = mkdtempSync(path.join(tmpdir(), 'lexcraft-entry-'));
  const webDir = path.join(root, 'web');
  mkdirSync(path.join(webDir, 'assets'), { recursive: true });
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>LexCraft</title><script src="/assets/app.js"></script>');
  writeFileSync(path.join(webDir, 'assets', 'app.js'), 'void 0;');
  return {
    dataDir: path.join(root, 'data'),
    webDir,
    keyHex: randomBytes(32).toString('hex'),
    launchSecret: randomBytes(32).toString('base64url'),
    port: 20000 + Math.floor(Math.random() * 30000),
  };
}

/**
 * A stand-in for the Python API, named in LEGAL_API_URL for every launch: the local mode must never call it (nor any
 * other source) in this version.
 */
const legalApi = { url: '', hits: 0, server: http.createServer() };

/** The arguments and environment that start the entry point for a launch. */
function command(launch: Launch): { args: string[]; env: NodeJS.ProcessEnv; cwd: string } {
  return {
    args: [TSX, '--tsconfig', TSCONFIG, MAIN],
    env: { ...baseEnv(), LEXCRAFT_DATA_DIR: launch.dataDir, LEXCRAFT_WEB_DIR: launch.webDir, LEXCRAFT_PORT: String(launch.port), LEGAL_API_URL: legalApi.url },
    cwd: path.dirname(launch.dataDir),
  };
}

interface Running {
  child: ChildProcess;
  port: number;
  stderr: () => string;
  exited: Promise<number | null>;
}

/** Starts the entry point and waits for its READY line; rejects with its stderr when it exits first. */
function start(launch: Launch): Promise<Running> {
  const { args, env, cwd } = command(launch);
  const child = spawn(process.execPath, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stderr!.on('data', (chunk) => { err += String(chunk); });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  child.stdin!.write(`key=${launch.keyHex} launch=${launch.launchSecret}\n`);
  return new Promise((resolve, reject) => {
    child.stdout!.on('data', (chunk) => {
      out += String(chunk);
      const ready = /^LEXCRAFT_READY port=(\d+) ready_ms=(\d+)$/m.exec(out);
      if (ready) resolve({ child, port: Number(ready[1]), stderr: () => err, exited });
    });
    void exited.then((code) => reject(new Error(`the entry point exited (${code}) before READY: ${err.trim()}`)));
  });
}

async function openWindow(running: Running, launch: Launch): Promise<string> {
  const answer = await call(running.port, { method: 'POST', path: SESSION_PATH, headers: { authorization: `Bearer ${launch.launchSecret}` } });
  expect(answer.status).toBe(200);
  return cookieHeader((JSON.parse(answer.text) as { cookies: Array<{ name: string; value: string }> }).cookies);
}

const launch = newLaunch();
let running: Running;
let window: string;

beforeAll(async () => {
  legalApi.server.on('request', (_req, res) => { legalApi.hits += 1; res.writeHead(500).end(); });
  await new Promise<void>((resolve) => legalApi.server.listen(0, '127.0.0.1', resolve));
  legalApi.url = `http://127.0.0.1:${(legalApi.server.address() as AddressInfo).port}`;
  running = await start(launch);
  window = await openWindow(running, launch);
}, 120_000);

afterAll(async () => {
  if (running.child.exitCode === null) {
    running.child.stdin!.end();
    await running.exited;
  }
  rmSync(path.dirname(launch.dataDir), { recursive: true, force: true });
  await new Promise<void>((resolve) => legalApi.server.close(() => resolve()));
});

describe('the local entry point', () => {
  it('answers READY on 127.0.0.1 and refuses a request without the window cookie, the secret in the URL included', async () => {
    expect(running.port).toBeGreaterThanOrEqual(launch.port);
    expect((await call(running.port, { path: '/api/health' })).status).toBe(403);
    expect((await call(running.port, { path: `/api/health?k=${launch.launchSecret}` })).status).toBe(403);
    expect((await call(running.port, { path: `${SESSION_PATH}?k=${launch.launchSecret}` })).status).toBe(403);
    expect((await call(running.port, { method: 'POST', path: `${SESSION_PATH}?k=${launch.launchSecret}` })).status).toBe(403);
    expect((await call(running.port, { path: '/' })).status).toBe(403);
  });

  it('listens on the loopback address only', async () => {
    const elsewhere = ['::1', ...Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i!.address)];
    for (const address of elsewhere) {
      const reached = await new Promise<boolean>((resolve) => {
        const socket = connect({ host: address, port: running.port, timeout: 1000 });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
      });
      expect({ address, reached }).toEqual({ address, reached: false });
    }
  });

  it("opens the window only for the shell's launch secret, never for a browser", async () => {
    expect((await call(running.port, { method: 'POST', path: SESSION_PATH })).status).toBe(403);
    expect((await call(running.port, { method: 'POST', path: SESSION_PATH, headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` } })).status).toBe(403);
    const fromPage = await call(running.port, {
      method: 'POST',
      path: SESSION_PATH,
      headers: { authorization: `Bearer ${launch.launchSecret}`, origin: `http://127.0.0.1:${running.port}`, 'sec-fetch-site': 'same-origin' },
    });
    expect(fromPage.status).toBe(403);
  });

  it('with the window cookies: the local profile, a Work write and read; no CORS header anywhere', async () => {
    const health = await call(running.port, { path: '/api/health', headers: { cookie: window } });
    expect(health.status).toBe(200);
    expect(Object.keys(health.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);

    const me = await call(running.port, { path: '/api/auth/me', headers: { cookie: window } });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.text)).toMatchObject({ username: 'profilo-locale' });
    const windowOnly = window.split('; ').filter((part) => part.startsWith(`${WINDOW_COOKIE}=`)).join('; ');
    expect((await call(running.port, { path: '/api/auth/me', headers: { cookie: windowOnly } })).status).toBe(401);

    // The web, moved to the session cookie, sends its header on every write (middleware/csrfGuard.ts).
    const web = { cookie: window, 'x-visualex-client': 'web', origin: `http://127.0.0.1:${running.port}`, 'sec-fetch-site': 'same-origin' };
    const created = await call(running.port, { method: 'POST', path: '/api/dossiers', headers: web, body: { name: 'Pratica di prova' } });
    expect(created.status).toBe(201);
    const id = (JSON.parse(created.text) as { id: string }).id;
    const read = await call(running.port, { path: `/api/dossiers/${id}`, headers: { cookie: window } });
    expect(read.status).toBe(200);
    expect(JSON.parse(read.text)).toMatchObject({ id, name: 'Pratica di prova' });
    expect(Object.keys(created.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });

  it('the window cookies do not help a foreign Origin, another Host or another site', async () => {
    expect((await call(running.port, { path: '/api/auth/me', headers: { cookie: window, origin: 'http://evil.example' } })).status).toBe(403);
    expect((await call(running.port, { path: '/api/auth/me', headers: { cookie: window, host: `localhost:${running.port}` } })).status).toBe(421);
    expect((await call(running.port, { path: '/api/auth/me', headers: { cookie: window, host: `rebind.evil.example:${running.port}` } })).status).toBe(421);
    expect((await call(running.port, { path: '/api/auth/me', headers: { cookie: window, 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    const preflight = await call(running.port, {
      method: 'OPTIONS',
      path: '/api/dossiers',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-visualex-client' },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('the sign-in routes say they are not needed; the online sections answer before the session', async () => {
    const login = await call(running.port, { method: 'POST', path: '/api/auth/login', headers: { cookie: window }, body: { email: 'a@b.it', password: 'x' } });
    expect(login.status).toBe(403);
    expect(JSON.parse(login.text)).toMatchObject({ detail: SIGN_IN_COPY });
    const windowOnly = window.split('; ').filter((part) => part.startsWith(`${WINDOW_COOKIE}=`)).join('; ');
    for (const route of ['/api/forum/communities', '/api/lingo/srs/oggi', '/api/merlt/health', '/api/admin/users', '/api/environments']) {
      const answer = await call(running.port, { path: route, headers: { cookie: windowOnly } });
      expect({ route, status: answer.status, body: JSON.parse(answer.text) }).toMatchObject({ route, status: 503, body: { detail: ONLINE_COPY } });
    }
  });

  it('reaches no source, not even the one LEGAL_API_URL names: a norm added by reference is unavailable', async () => {
    const web = { cookie: window, 'x-visualex-client': 'web', origin: `http://127.0.0.1:${running.port}` };
    const created = await call(running.port, { method: 'POST', path: '/api/dossiers', headers: web, body: { name: 'Riferimenti' } });
    const id = (JSON.parse(created.text) as { id: string }).id;
    const norms = await call(running.port, { method: 'POST', path: `/api/dossiers/${id}/norms`, headers: web, body: { references: ['art. 2043 c.c.'] } });
    expect(norms.status).toBe(200);
    expect(JSON.parse(norms.text)).toMatchObject({ results: [{ reference: 'art. 2043 c.c.', outcome: 'unavailable' }] });
    expect(legalApi.hits).toBe(0);
  });

  it('a source needs the network; the version answers', async () => {
    const text = await call(running.port, { method: 'POST', path: '/fetch_article_text', headers: { cookie: window }, body: { act_type: 'codice civile', article: '1453' } });
    expect(text.status).toBe(503);
    expect(JSON.parse(text.text)).toMatchObject({ detail: NETWORK_COPY });
    expect((await call(running.port, { path: '/version', headers: { cookie: window } })).status).toBe(200);
  });

  it('serves the built web with its policy, and the page for any other path', async () => {
    const page = await call(running.port, { path: '/', headers: { cookie: window } });
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>LexCraft</title>');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await call(running.port, { path: '/dossier/qualcosa', headers: { cookie: window } })).text).toContain('<title>LexCraft</title>');
    expect((await call(running.port, { path: '/assets/app.js', headers: { cookie: window } })).status).toBe(200);
  });

  it('a second process on the same data folder is refused', async () => {
    await expect(start(launch)).rejects.toThrow(/another LexCraft process has this data folder open/);
  }, 120_000);

  it('closing stdin stops it within 3 s; the folder opens again, with the same profile', async () => {
    const me = JSON.parse((await call(running.port, { path: '/api/auth/me', headers: { cookie: window } })).text) as { id: string };
    const t0 = Date.now();
    running.child.stdin!.end();
    await running.exited;
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(running.stderr()).toContain('stopping (stdin closed)');

    const again = await start(launch);
    try {
      const cookies = await openWindow(again, launch);
      expect((await call(again.port, { path: '/api/auth/me', headers: { cookie: window } })).status).toBe(403);
      const next = JSON.parse((await call(again.port, { path: '/api/auth/me', headers: { cookie: cookies } })).text) as { id: string };
      expect(next.id).toBe(me.id);
    } finally {
      again.child.stdin!.end();
      await again.exited;
    }
  }, 120_000);
});

describe('the configuration in local mode', () => {
  it('reads no .env from the folder the process started in', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lexcraft-dotenv-'));
    try {
      writeFileSync(path.join(dir, '.env'), 'LEXCRAFT_PROBE=read\n');
      writeFileSync(path.join(dir, 'probe.ts'), `require(${JSON.stringify(path.join(SERVER, 'src/config.ts'))}); process.stdout.write(process.env.LEXCRAFT_PROBE ?? 'unset');`);
      const run = (extra: NodeJS.ProcessEnv) => execFileSync(process.execPath, [TSX, '--tsconfig', TSCONFIG, path.join(dir, 'probe.ts')], {
        cwd: dir,
        env: { ...baseEnv(), JWT_SECRET: 'x', DATABASE_URL: 'file:x', ...extra },
      }).toString();
      expect(run({})).toBe('read');
      expect(run({ LEXCRAFT_MODE: 'local' })).toBe('unset');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('a shell gone during start-up', () => {
  it('the entry point stops instead of staying behind', async () => {
    const own = newLaunch();
    const { args, env, cwd } = command(own);
    const child = spawn(process.execPath, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr!.on('data', (chunk) => { err += String(chunk); });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    child.stdin!.end(`key=${own.keyHex} launch=${own.launchSecret}\n`);
    try {
      const code = await Promise.race([exited, new Promise<'still running'>((resolve) => setTimeout(() => resolve('still running'), 15_000))]);
      expect(code).toBe(0);
      expect(err).toMatch(/stopping \(stdin closed( during start-up)?\)/);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      rmSync(path.dirname(own.dataDir), { recursive: true, force: true });
    }
  }, 60_000);
});

describe('a killed shell', () => {
  it('leaves no server running: the entry point sees stdin end and stops itself', async () => {
    const own = newLaunch();
    const { args, env, cwd } = command(own);
    const log = path.join(path.dirname(own.dataDir), 'entry.log');
    // A stand-in shell: starts the entry point detached (on Windows, Node would otherwise put it in a job object
    // that ends it with the parent, which would hide the contract), waits for READY, prints the pid, and stays.
    const shell = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const log = fs.openSync(${JSON.stringify(log)}, 'a');
      const child = spawn(process.execPath, ${JSON.stringify(args)}, { env: ${JSON.stringify(env)}, cwd: ${JSON.stringify(cwd)}, detached: true, stdio: ['pipe', 'pipe', log] });
      child.stdin.write(${JSON.stringify(`key=${own.keyHex} launch=${own.launchSecret}\n`)});
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; if (out.includes('LEXCRAFT_READY')) process.stdout.write('CHILD ' + child.pid + '\\n'); });
      setInterval(() => undefined, 1000);
    `;
    const parent = spawn(process.execPath, ['-e', shell], { stdio: ['ignore', 'pipe', 'inherit'] });
    let pid = 0;
    try {
      pid = await new Promise<number>((resolve, reject) => {
        let out = '';
        parent.stdout!.on('data', (chunk) => {
          out += String(chunk);
          const match = /CHILD (\d+)/.exec(out);
          if (match) resolve(Number(match[1]));
        });
        parent.once('exit', (code) => reject(new Error(`the stand-in shell exited (${code}): ${readFileSync(log, 'utf8')}`)));
      });
      parent.kill('SIGKILL');
      const alive = (): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
      const deadline = Date.now() + 5000;
      while (alive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      expect(alive()).toBe(false);
      expect(readFileSync(log, 'utf8')).toContain('stopping (stdin closed)');
    } finally {
      if (parent.exitCode === null) parent.kill('SIGKILL');
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
      rmSync(path.dirname(own.dataDir), { recursive: true, force: true });
    }
  }, 120_000);
});
