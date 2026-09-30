import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// In production the ingress refuses a scraping call that carries no login token, so a bare
// fetch to one of those routes works in development and fails once deployed. This keeps
// every such call on legalFetch, the way infra/ingress/paths.test.mjs keeps the ingress
// in step with Vite.
const src = join(__dirname, '..', '..'); // apps/web/src
const vite = readFileSync(join(src, '..', 'vite.config.ts'), 'utf8');

// The Python routes are what Vite proxies to port 5000 (and what the ingress gates)…
const pythonRoutes = [...vite.matchAll(/'(\/[\w-]+)'\s*:\s*'http:\/\/localhost:5000'/g)].map((m) => m[1]);
// …except the two the ingress leaves open. /health/detailed is not one of them.
const open = new Set(['/version', '/health']);
const gated = [...pythonRoutes.filter((route) => !open.has(route)), '/health/detailed'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sources(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const escape = (route: string) => route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const bareFetch = new RegExp('\\bfetch\\(\\s*[`\'"](' + gated.map(escape).join('|') + ')');

describe('the scraping routes are called through legalFetch', () => {
  it('reads the route list from the Vite config', () => {
    expect(pythonRoutes.length).toBeGreaterThanOrEqual(10);
    expect(gated).not.toContain('/version');
    expect(gated).toContain('/fetch_article_text');
  });

  it('no source file calls a gated route with a bare fetch', () => {
    const offenders = sources(src)
      .filter((file) => !file.endsWith(join('services', 'legalFetch.ts')))
      .filter((file) => bareFetch.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(src.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the health probe, which takes its URL as a variable, goes through legalFetch too', () => {
    const health = readFileSync(join(src, 'services', 'healthService.ts'), 'utf8');
    expect(health).toMatch(/legalFetch\(/);
    expect(health).not.toMatch(/[^A-Za-z.]fetch\(/);
  });

  it('the unauthenticated duplicate client is gone', () => {
    expect(existsSync(join(src, 'services', 'legalApi.ts'))).toBe(false);
  });
});
