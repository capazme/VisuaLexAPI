import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// The motion rules of the Inchiostro redesign (spec 2026-10-18-redesign-inchiostro §4.4, §6.1),
// kept from coming back one file at a time: a transition names what it moves, and a spring comes
// from lib/motion.ts instead of being typed in a component.
const src = join(__dirname, '..'); // apps/web/src

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sources(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  return sources(src)
    .map((file) => relative(src, file))
    .filter((file) => !allowed.includes(file))
    .filter((file) => pattern.test(readFileSync(join(src, file), 'utf8')));
}

describe('the motion rules', () => {
  it('no component transitions `all`: it animated the focus ring in, and layout', () => {
    expect(offenders(/\btransition-all\b/)).toEqual([]);
  });

  it('no component types a spring by hand', () => {
    // The Gymnasium celebration's stamp stays as it is (spec §6.3, item 7).
    const celebration = join('components', 'features', 'studia', 'progress', 'Celebration.tsx');
    expect(offenders(/\b(stiffness|damping)\s*:/, [celebration])).toEqual([]);
  });
});
