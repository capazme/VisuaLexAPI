import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Three pieces left out of the chunk every page loads, sign-in included: driver.js (the tours), the study packs' data
// and the comparison. One static import, anywhere, puts one back, and the build would not say so.
const src = __dirname; // apps/web/src

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sources(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** A value import or re-export from `module` (a side-effect import too); `import type` is erased and allowed. */
const staticImport = (module: string) =>
  new RegExp(`^\\s*(?:import|export)\\s+(?:(?!type\\b)[^;'"]*?from\\s+)?['"]${module}['"]`, 'm');

const offenders = (pattern: RegExp, except: (file: string) => boolean = () => false) =>
  sources(src)
    .map((file) => file.slice(src.length + 1))
    .filter((file) => !except(file) && pattern.test(readFileSync(join(src, file), 'utf8')));

describe('what every page loads leaves out the tours, the study packs and the comparison', () => {
  it('driver.js and its stylesheet come only with a tour (useTour)', () => {
    expect(offenders(staticImport('driver\\.js(?:/[^\'"]*)?'))).toEqual([]);
  });

  it('the study packs\' data comes only when the band asks for it (loadStudyPacks)', () => {
    expect(offenders(staticImport('[./]*(?:\\.\\./)*data/exampleEnvironments'))).toEqual([]);
  });

  it('the comparison comes only when it first opens (Layout\'s lazy import)', () => {
    const inCompare = (file: string) => file.startsWith(join('components', 'features', 'compare') + '/');
    expect(offenders(staticImport('[./]*(?:[\\w-]+/)*compare(?:/CompareView|/index)?'), inCompare)).toEqual([]);
  });
});
