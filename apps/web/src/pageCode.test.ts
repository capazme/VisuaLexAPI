import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** A value import or re-export from a module whose path ends so (with or without `.ts`/`.tsx`); `import type` is erased. */
const staticImport = (tail: string) =>
  new RegExp(`^\\s*(?:import|export)\\s+(?:(?!type\\b)[^;'"]*?from\\s+)?['"][./\\w-]*${tail}(?:\\.tsx?)?['"]`, 'm');

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
    const pages = [
      'dossier/DossierPage', 'history/HistoryView', 'bulletin/BulletinBoardPage', 'bulletin/ForumCommunityPage',
      'documents/DocumentReviewPage', 'pages/CreditsPage', 'connections/ConnectAiAppPage', 'planner/OpusPage',
      'planner/OpusViews',
      // The connections' index re-exports «Collega un'app AI»: its parts are imported from their own files.
      'features/connections', 'features/connections/index',
    ];
    const offenders = sources(src)
      .map((file) => file.slice(src.length + 1))
      .flatMap((file) => {
        const text = readFileSync(join(src, file), 'utf8');
        return pages.filter((page) => staticImport(page).test(text)).map((page) => `${file} → ${page}`);
      });
    expect(offenders).toEqual([]);
  });
});
