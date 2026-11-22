import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// What Vite proxies to the Python API in development is what the ingress routes to the scrapers in production, path
// for path. The list is the contract's (conventions/contract/legal-paths.json): the core checks its Caddyfile against
// it (infra/ingress/paths.test.mjs there), and this checks the Vite config. A path proxied here and not routed there
// works in development and answers 404 once deployed.
const src = join(__dirname, '..', '..'); // the app's src
const vite = readFileSync(join(src, '..', 'vite.config.ts'), 'utf8');

function contractPaths(from: string): string[] {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'contract', 'legal-paths.json');
    if (existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as { paths: string[] }).paths;
    if (dirname(dir) === dir) throw new Error('conventions/contract/legal-paths.json not found above ' + from);
  }
}

const proxied = [...vite.matchAll(/'(\/[\w\-/]+)'\s*:\s*PYTHON_API\b/g)].map((m) => m[1]);

describe('the Vite proxy to the Python API is the contract', () => {
  it('reads every entry', () => {
    // A key the regex cannot read would drop out of the comparison below: count them another way.
    const entries = vite.match(/:\s*PYTHON_API\b/g) ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(proxied).toHaveLength(entries.length);
  });

  it('proxies exactly the contract\'s paths', () => {
    expect([...proxied].sort()).toEqual([...contractPaths(__dirname)].sort());
  });
});
