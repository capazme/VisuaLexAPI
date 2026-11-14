/**
 * Every key the web writes to the browser's storage is listed in `BROWSER_STORAGE` (`sessionEnd.ts`), with what
 * it holds: a key added without being classified fails here, so the person's data never stays behind a sign-out
 * by oversight (scan A.5).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BROWSER_STORAGE } from '../sessionEnd';

const SRC = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'test' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

/** `NAME = 'value'` anywhere in the sources: a constant a storage call names. */
function constant(name: string, own: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*['"\`]([^'"\`$]+)['"\`]`);
  const inOwn = own.match(pattern);
  if (inOwn) return inOwn[1];
  for (const { text } of files) {
    const found = text.match(new RegExp(`export const ${name}\\s*=\\s*['"\`]([^'"\`$]+)['"\`]`));
    if (found) return found[1];
  }
  return null;
}

/** A key builder `name = (…) => \`prefix${…}\``: its family, `prefix*`. */
function family(name: string, own: string): string | null {
  const found = own.match(new RegExp(`\\b${name}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\`([^\`$]*)\\$\\{`));
  return found ? `${found[1]}*` : null;
}

interface Written {
  file: string;
  area: 'local' | 'session';
  key: string | null;
  arg: string;
}

function writtenKeys(): Written[] {
  const out: Written[] = [];
  for (const { path, text } of files) {
    for (const m of text.matchAll(/\b(localStorage|sessionStorage)\.setItem\(\s*([^,]+?)\s*,/g)) {
      const area = m[1] === 'localStorage' ? 'local' : 'session';
      const arg = m[2];
      let key: string | null = null;
      const literal = arg.match(/^['"`]([^'"`$]+)['"`]$/);
      const call = arg.match(/^([A-Za-z_$][\w$]*)\(/);
      if (literal) key = literal[1];
      else if (call) key = family(call[1], text);
      else if (/^[A-Za-z_$][\w$]*$/.test(arg)) key = constant(arg, text);
      out.push({ file: path, area, key, arg });
    }
    // zustand `persist(…, { name: '…', storage: … localStorage … })`
    if (/\bpersist\(/.test(text) && /from 'zustand\/middleware'/.test(text)) {
      // the `name:` of the persist options (zustand's default storage is localStorage): every `name:` that is
      // followed, before the next `name:`, by a persist option, or that sits right after a `persist(` call
      const options = /\bname:\s*([A-Za-z_$][\w$]*|'[^']+')\s*,((?:(?!\bname:)[\s\S]){0,2000}?\b(storage|partialize|version|migrate|merge)\s*:[^\n]*)/g;
      for (const m of text.matchAll(options)) {
        const raw = m[1];
        const key = raw.startsWith("'") ? raw.slice(1, -1) : constant(raw, text);
        out.push({ file: path, area: /sessionStorage/.test(m[2]) ? 'session' : 'local', key, arg: raw });
      }
    }
  }
  return out;
}

/** Files allowed to call `.setItem` on something other than the bare storages (wrappers, the inventory itself). */
const OTHER_RECEIVERS = new Set(['utils/guardedStorage.ts', 'services/sessionEnd.ts']);

describe('the inventory of the browser storage', () => {
  const written = writtenKeys();

  it('finds the keys it is meant to (the scan itself works)', () => {
    const keys = written.map((w) => w.key);
    expect(keys).toContain('merlt-qa-thread-v1');
    expect(keys).toContain('visualex-storage');
    expect(keys).toContain('access_token');
    expect(keys).toContain('visualex:case-law-open:*');
  });

  it('resolves every key the sources write', () => {
    expect(written.filter((w) => w.key === null).map((w) => `${w.file}: ${w.arg}`)).toEqual([]);
  });

  it('lists every key written, in its storage, with what it holds', () => {
    const listed = new Set(BROWSER_STORAGE.map((e) => `${e.area}:${e.key}`));
    const missing = written
      .filter((w) => w.key !== null && !listed.has(`${w.area}:${w.key}`))
      .map((w) => `${w.file}: ${w.area}Storage «${w.key}» — classify it in BROWSER_STORAGE (sessionEnd.ts)`);
    expect(missing).toEqual([]);
  });

  it('writes the storage only through the bare globals, outside the known wrappers', () => {
    const odd = files
      .filter(({ path }) => !OTHER_RECEIVERS.has(path))
      .flatMap(({ path, text }) =>
        [...text.matchAll(/([\w$.\])?]+)\.setItem\(/g)]
          .map((m) => m[1])
          .filter((receiver) => !/^(window\.)?(localStorage|sessionStorage)$/.test(receiver))
          .map((receiver) => `${path}: ${receiver}.setItem`),
      );
    const indexed = files.filter(({ text }) => /\bindexedDB\b|document\.cookie|\bcaches\.open\(/.test(text)).map((f) => f.path);
    const bracket = files.filter(({ text }) => /(localStorage|sessionStorage)\[[^\]]+\]\s*=[^=]/.test(text)).map((f) => f.path);
    expect([...odd, ...indexed, ...bracket]).toEqual([]);
  });

  it('lists each key once', () => {
    const seen = BROWSER_STORAGE.map((e) => `${e.area}:${e.key}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('removes only exact keys among the user data (a family cannot be removed by name)', () => {
    expect(BROWSER_STORAGE.filter((e) => e.kind === 'user' && e.key.endsWith('*'))).toEqual([]);
  });
});
