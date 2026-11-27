#!/usr/bin/env node
// The desktop app's local server, built (`npm run build:local`), driven as the app's shell and its window would drive
// it (spec §6 and §8), on a temporary data folder with a key made for the run. The trial's flow, kept as the local CI
// job's smoke test: the port's checks, the shell's exchange, Work written and read, the trash, a restart that finds
// everything again, one process per data folder. Each check prints one line; any failure exits 1.
//   npm run local:flow
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(root, 'dist-local/main.cjs');
if (!existsSync(MAIN)) {
  console.error('[local-flow] dist-local/main.cjs is missing: run `npm run build:local` first');
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), 'lexcraft-flow-'));
const dataDir = path.join(work, 'data');
const webDir = path.join(work, 'web');
mkdirSync(webDir, { recursive: true });
writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>LexCraft</title>');
const keyHex = randomBytes(32).toString('hex');
const preferredPort = 20000 + Math.floor(Math.random() * 30000);
const running = new Set();

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'ok' : 'NOT OK'} ${passed + failed} - ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

/** Starts the server as the shell does; resolves at READY, or with the exit and stderr if it ends first. */
function start(launchSecret) {
  const child = spawn(process.execPath, [MAIN], {
    cwd: work,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LEXCRAFT_DATA_DIR: dataDir, LEXCRAFT_WEB_DIR: webDir, LEXCRAFT_PORT: String(preferredPort) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  running.add(child);
  let out = '';
  let err = '';
  child.stderr.on('data', (chunk) => { err += chunk; });
  const exited = new Promise((resolve) => child.once('exit', (code) => { running.delete(child); resolve(code); }));
  child.stdin.write(`key=${keyHex} launch=${launchSecret}\n`);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ child, exited, ready: false, stderr: () => err, why: 'no READY within 60 s' }), 60_000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const ready = /^LEXCRAFT_READY port=(\d+) ready_ms=(\d+)$/m.exec(out);
      if (ready) {
        clearTimeout(timer);
        resolve({ child, exited, ready: true, port: Number(ready[1]), readyMs: Number(ready[2]), stderr: () => err });
      }
    });
    void exited.then((code) => { clearTimeout(timer); resolve({ child, exited, ready: false, stderr: () => err, why: `exited ${code}` }); });
  });
}

async function stop(server) {
  const t0 = Date.now();
  server.child.stdin.end();
  const code = await server.exited;
  return { code, ms: Date.now() - t0 };
}

function call(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const sent = { host: `127.0.0.1:${port}`, ...headers };
  if (payload !== undefined) Object.assign(sent, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: target, headers: sent, agent: false }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: response.statusCode, headers: response.headers, text, json });
      });
    });
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

/** The shell's exchange; returns the Cookie header the window will send. */
async function openWindow(port, launchSecret) {
  const answer = await call(port, { method: 'POST', path: '/__lexcraft/session', headers: { authorization: `Bearer ${launchSecret}` } });
  const cookies = answer.json?.cookies ?? [];
  return { status: answer.status, count: cookies.length, cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

async function flow() {
  // 1. Start, READY.
  const launch1 = randomBytes(32).toString('base64url');
  const first = await start(launch1);
  check('the server answers READY on 127.0.0.1', first.ready, first.why ?? first.stderr());
  if (!first.ready) return;
  const port = first.port;

  // 2-5. The port's checks, before the window exists.
  check('no window cookie: 403', (await call(port, { path: '/api/health' })).status === 403);
  check('another Host: 421', (await call(port, { path: '/api/health', headers: { host: `localhost:${port}` } })).status === 421);
  check('a foreign Origin: 403', (await call(port, { path: '/api/health', headers: { origin: 'http://evil.example' } })).status === 403);
  check('the launch secret in a URL: 403', (await call(port, { path: `/__lexcraft/session?k=${launch1}` })).status === 403);

  // 6-7. The shell's exchange, then the window's session is the local profile.
  const window1 = await openWindow(port, launch1);
  check("the shell's exchange gives the window its two cookies", window1.status === 200 && window1.count === 2, `status ${window1.status}`);
  const me = await call(port, { path: '/api/auth/me', headers: { cookie: window1.cookie } });
  check('the window is the local profile', me.status === 200 && me.json?.username === 'profilo-locale', `status ${me.status}`);

  // 8-11. Work, as the web writes it (its header on every write).
  const web = { cookie: window1.cookie, 'x-visualex-client': 'web', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' };
  const dossier = await call(port, { method: 'POST', path: '/api/dossiers', headers: web, body: { name: 'Pratica Rossi' } });
  check('a practice is created', dossier.status === 201, `status ${dossier.status}`);
  const dossierId = dossier.json?.id;
  const entry = await call(port, { method: 'POST', path: `/api/dossiers/${dossierId}/items`, headers: web, body: { itemType: 'note', title: 'Appunto', content: 'Termine per la memoria: 20 giorni.' } });
  check('an entry is added to it', entry.status === 201, `status ${entry.status}`);
  const note = await call(port, { method: 'POST', path: `/api/dossiers/${dossierId}/notes`, headers: web, body: { text: 'Sentire il cliente lunedì.' } });
  check('a note is added to it', note.status === 201, `status ${note.status}`);
  const highlight = await call(port, {
    method: 'POST',
    path: '/api/highlights',
    headers: web,
    body: { normaKey: 'codice-civile--262--1942-03-16--1453::art::1453', text: 'risoluzione', color: 'yellow', startOffset: 10, endOffset: 21 },
  });
  check('a highlight is made', highlight.status === 201, `status ${highlight.status}`);

  // 12-13. The trash: an entry goes, and comes back.
  const trashed = await call(port, { method: 'POST', path: `/api/dossiers/${dossierId}/trash-items`, headers: web, body: { itemIds: [entry.json?.id] } });
  const trashId = trashed.json?.trashId;
  const afterTrash = await call(port, { path: `/api/dossiers/${dossierId}`, headers: { cookie: window1.cookie } });
  const titles = (answer) => (answer.json?.items ?? []).map((item) => item.title);
  check('an entry goes to the trash', trashed.status === 200 && Boolean(trashId) && !titles(afterTrash).includes('Appunto'), `status ${trashed.status}`);
  const restored = await call(port, { method: 'POST', path: `/api/trash/${trashId}/restore`, headers: web, body: {} });
  const afterRestore = await call(port, { path: `/api/dossiers/${dossierId}`, headers: { cookie: window1.cookie } });
  check('it comes back from the trash', restored.status === 200 && titles(afterRestore).includes('Appunto'), `status ${restored.status}`);

  // 14-15. What M1 does not do says so.
  const source = await call(port, { method: 'POST', path: '/fetch_article_text', headers: web, body: { act_type: 'codice civile', article: '1453' } });
  check('a source needs the network: 503', source.status === 503 && source.json?.detail === 'Per questo testo serve la rete.', `status ${source.status}`);
  const forum = await call(port, { path: '/api/forum/communities', headers: { cookie: window1.cookie } });
  check('an online section: 503', forum.status === 503, `status ${forum.status}`);

  // 16. One process per data folder.
  const second = await start(randomBytes(32).toString('base64url'));
  check('a second process on the data folder is refused', !second.ready && /another LexCraft process/.test(second.stderr()), second.ready ? 'it started' : second.stderr());
  if (second.ready) await stop(second);

  // 17. The shell closes: the server stops by itself.
  const stopped = await stop(first);
  check('closing stdin stops the server within 3 s', stopped.code === 0 && stopped.ms < 3000, `exit ${stopped.code} after ${stopped.ms} ms`);

  // 18-19. A new launch finds everything; the old window's cookies open nothing.
  const launch2 = randomBytes(32).toString('base64url');
  const again = await start(launch2);
  if (!again.ready) {
    check('a restart answers READY', false, again.why ?? again.stderr());
    return;
  }
  check("the earlier launch's cookies open nothing", (await call(again.port, { path: '/api/auth/me', headers: { cookie: window1.cookie } })).status === 403);
  const window2 = await openWindow(again.port, launch2);
  const kept = await call(again.port, { path: `/api/dossiers/${dossierId}`, headers: { cookie: window2.cookie } });
  const marks = await call(again.port, { path: `/api/highlights?normaKey=${encodeURIComponent('codice-civile--262--1942-03-16--1453::art::1453')}`, headers: { cookie: window2.cookie } });
  const keptText = JSON.stringify(kept.json ?? '');
  const found = {
    entry: titles(kept).includes('Appunto'),
    note: keptText.includes('Sentire il cliente lunedì.'),
    highlight: JSON.stringify(marks.json ?? '').includes('risoluzione'),
  };
  check(
    'after a restart the practice, its entry, its note and the highlight are there',
    kept.status === 200 && marks.status === 200 && found.entry && found.note && found.highlight,
    `status ${kept.status}, highlights ${marks.status}, ${JSON.stringify(found)}`,
  );
  await stop(again);
}

try {
  await flow();
} catch (error) {
  check('the flow ran to its end', false, error instanceof Error ? error.message : String(error));
} finally {
  for (const child of running) child.kill();
  // Retried: on Windows a file a process has just let go can still be busy for a moment.
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(`${passed} / ${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
