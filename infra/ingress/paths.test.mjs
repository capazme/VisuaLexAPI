// The ingress must send the browser's scraping calls to the scrapers and nothing
// else of the Python API. The list of those calls already exists: it is what Vite
// proxies to port 5000 in development. These tests keep the Caddyfile in step with
// it, prefix for prefix (a Vite key matches by prefix, so '/health' also covers
// '/health/detailed').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vite = readFileSync(join(root, 'apps/web/vite.config.ts'), 'utf8');
const caddyfile = readFileSync(join(root, 'infra/ingress/Caddyfile'), 'utf8');

function vitePythonPaths() {
  return [...vite.matchAll(/'(\/[\w\-/]+)'\s*:\s*'http:\/\/localhost:5000'/g)]
    .map((m) => m[1])
    .sort();
}

function caddyLegalTokens() {
  const line = caddyfile.match(/^\s*@legal\s+path\s+(.+)$/m);
  assert.ok(line, 'the Caddyfile has no "@legal path …" matcher');
  return line[1].trim().split(/\s+/);
}

test('every Vite proxy entry to the Python API was read', () => {
  // A key the regex cannot read would drop out of the comparison below and let the
  // ingress drift from Vite without a red test: count them another way.
  const entries = vite.match(/localhost:5000/g) ?? [];
  assert.ok(entries.length >= 10, 'could not read the Vite proxy list');
  assert.equal(vitePythonPaths().length, entries.length);
});

test('the ingress routes exactly the paths Vite sends to the Python API', () => {
  const routed = caddyLegalTokens().map((token) => token.replace(/\*$/, '')).sort();
  assert.deepEqual(routed, vitePythonPaths());
});

test('every scraping path is a prefix match, like a Vite proxy key', () => {
  for (const token of caddyLegalTokens()) {
    assert.ok(token.endsWith('*'), `${token} must end with * to match by prefix`);
  }
});

test('nothing else of the Python API is routed to it', () => {
  // The Python API keeps a global search history and a dossier file of its own,
  // and a circuit-breaker status page. None of them is for the outside.
  for (const forbidden of ['/history', '/dossiers', '/api/circuit-breakers']) {
    assert.ok(
      !caddyLegalTokens().some((token) => token.startsWith(forbidden)),
      `${forbidden} must not be routed to the scrapers`,
    );
  }
});
