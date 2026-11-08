import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// jsPDF, with pako and fast-png, is ~120 KB compressed. A single value import of it, anywhere,
// puts it back in the chunk every page loads, sign-in included; the build would not say so.
// Only `import type` may name it statically; the code reaches it through loadJsPdf.
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

const staticImport = /^\s*(?:import|export)\s+(?:(?!type\b)[^;'"]*?from\s+)?['"](jspdf|pako|fast-png|fflate|iobuffer)['"]/m;
const dynamicImport = /\bimport\(\s*['"]jspdf['"]\s*\)/;

describe('jsPDF is loaded only when a PDF is written', () => {
  it('no source file imports or re-exports jsPDF or what it brings (pako, fast-png, fflate, iobuffer) as a value', () => {
    const offenders = sources(src)
      .filter((file) => staticImport.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(src.length + 1));
    expect(offenders).toEqual([]);
  });

  it('loadJsPdf is the one place that imports it, dynamically', () => {
    const importers = sources(src)
      .filter((file) => dynamicImport.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(src.length + 1));
    expect(importers).toEqual([join('utils', 'loadJsPdf.ts')]);
  });
});
