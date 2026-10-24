import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { PAGE_CODE, pageCodeFor } from './pageCode';
import { SECTION_HOME_CODE } from './features/sections/sections';

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

/** The modules a file imports or re-exports as values (`import type` is erased), each as a path from `src`, no extension. */
function valueImports(file: string): string[] {
  const text = readFileSync(join(src, file), 'utf8');
  const found = text.matchAll(/^\s*(?:import|export)\s+(?:(?!type\b)[^;'"]*?from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm);
  return [...found].map((m) => relative(src, resolve(dirname(join(src, file)), m[1])).replace(/\.tsx?$/, '').replace(/\/index$/, ''));
}

describe('the pages loaded with their route (P1)', () => {
  it('knows the code each address waits for', () => {
    expect(pageCodeFor('/dossier')).toBe(PAGE_CODE.dossier);
    expect(pageCodeFor('/history')).toBe(PAGE_CODE.history);
    expect(pageCodeFor('/forum')).toBe(PAGE_CODE.forum);
    expect(pageCodeFor('/forum/community')).toBe(PAGE_CODE.community);
    expect(pageCodeFor('/documents')).toBe(PAGE_CODE.documents);
    expect(pageCodeFor('/crediti')).toBe(PAGE_CODE.credits);
    expect(pageCodeFor('/collega-app')).toBe(PAGE_CODE.connectAiApp);
    expect(pageCodeFor('/opus/oggi')).toBe(PAGE_CODE.opus);
    // Ricerca and the sign-in page are in the first chunk; Gymnasium and Academia have their own.
    expect(pageCodeFor('/')).toBeNull();
    expect(pageCodeFor('/login')).toBeNull();
    expect(pageCodeFor('/forumx')).toBeNull();
  });

  it('are fetched for a section change from the same modules, so the change (T1) finds Opus and the Forum there', () => {
    expect(SECTION_HOME_CODE.opus).toBe(PAGE_CODE.opus);
    expect(SECTION_HOME_CODE.forum).toBe(PAGE_CODE.forum);
  });

  it('are imported statically nowhere, so none comes back into the first chunk', () => {
    const pages = new Set([
      'components/features/dossier/DossierPage', 'components/features/history/HistoryView',
      'components/features/bulletin/BulletinBoardPage', 'components/features/bulletin/ForumCommunityPage',
      'components/features/documents/DocumentReviewPage', 'pages/CreditsPage', 'features/connections/ConnectAiAppPage',
      'components/features/planner/OpusPage', 'components/features/planner/OpusViews',
      // A folder's index that would re-export one of them (the connections had one, with «Collega un'app AI»).
      'features/connections',
    ]);
    const files = sources(src).map((file) => relative(src, file));
    expect(files.length).toBeGreaterThan(300);
    const offenders = files.flatMap((file) => valueImports(file).filter((module) => pages.has(module)).map((module) => `${file} → ${module}`));
    expect(offenders).toEqual([]);
    // The reading itself: a static import of a page, by any path, is seen.
    expect(valueImports('pageCode.ts')).toEqual([]);
    expect(valueImports(join('components', 'layout', 'Sidebar.tsx'))).toContain('pageCode');
  });
});
