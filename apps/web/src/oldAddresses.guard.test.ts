import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// The addresses took their sections' names (D-235): /work, /learn, /labs. The old ones (/opus, /studia, /merlt,
// /grafo) live only in `App.tsx`'s redirects (`MovedTo`). This refuses any other string or pattern of the sources
// that starts with an old address. The server's paths (`'/merlt/consent'`, `/api/…`) never match: an API path under
// /merlt is never one of the app's pages.
const src = __dirname; // apps/web/src

const OLD_ADDRESS = new RegExp([
  /['"`]\/(opus|studia|grafo)(?![\w-])/.source,
  /['"`]\/merlt(?=['"`?#]|\/(contribuisci|valida|qa|chiedi)(?![\w-]))/.source,
  /(?<!labs)\\\/(opus|studia|merlt|grafo)(?![\w-])/.source,
].join('|'));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('the old addresses', () => {
  it('no link, navigation or address check points at one, but the redirects', () => {
    const found = sources(src).flatMap((file) => readFileSync(file, 'utf8').split('\n')
      .flatMap((line, i) => (OLD_ADDRESS.test(line) && !line.includes('<MovedTo') ? [`${relative(src, file)}:${i + 1}`] : [])));
    expect(found).toEqual([]);
  });

  it('the pattern catches an old address and leaves the server\'s paths alone', () => {
    for (const line of [`to="/opus/oggi"`, `navigate('/studia/ripasso')`, 'to={`/grafo?urn=${u}`}', `'/merlt'`, `"/merlt/valida"`, String.raw`/^\/studia\/schede/`]) {
      expect(OLD_ADDRESS.test(line), line).toBe(true);
    }
    for (const line of [`'/merlt/consent'`, `'/merlt/validate/pending'`, `'/api/studia/cards'`, `'/opuscolo'`, `import('./features/studia/x')`, String.raw`/^\/labs\/grafo(\/|$)/`]) {
      expect(OLD_ADDRESS.test(line), line).toBe(false);
    }
  });
});
