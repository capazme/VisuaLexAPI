import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL_PAGE_FRAME, PAGE_FRAME } from './frame';

const read = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

describe('the frame (U1)', () => {
  it('pads the window 16 px, 32 from md and 48 from 1536 px, outside the frame', () => {
    expect(PAGE_FRAME.split(' ')).toEqual(['mx-auto', 'box-content', 'px-4', 'md:px-8', '2xl:px-12']);
  });

  it('widens `Layout` to the full screen\'s frame for the pages that say `full`', () => {
    expect(FULL_PAGE_FRAME).toBe('has-[[data-page-width=full]]:max-w-frame-full');
  });
});

/** The search page's caps one inside the other (898 px at any width, 770 in full screen) are gone: the frame is its one. */
describe('the search page has one limit, the frame\'s (U1)', () => {
  it('declares itself `full`, with no cap of its own', () => {
    const source = read('pages/SearchPage.tsx');
    expect(source).toMatch(/data-page-width="full"/);
    expect(source).not.toMatch(/<ReaderLayout|from '[^']*ReaderLayout'|className=[^>]*\bmax-w-/);
    expect(existsSync(resolve(process.cwd(), 'src/components/layout/ReaderLayout.tsx'))).toBe(false);
  });

  it('draws the practice and its loading skeleton at the frame\'s width', () => {
    expect(read('components/features/practice/PracticeTable.tsx')).not.toMatch(/\bmax-w-/);
    expect(read('components/features/search/SearchPanel.tsx')).not.toMatch(/animate-pulse[^"]*max-w-|max-w-[^"]*animate-pulse/);
  });
});

/** Every source file of the app, tests aside. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * One reading measure (U1): a long text's column is `max-w-measure`, the theme's 70 characters, never a number written
 * where it is used (five lived side by side: 60, 65, 68, 70 characters and `max-w-prose`). `max-w-prose` stays only on
 * a short line. The sign-in page's display line is outside the sections.
 */
describe('one reading measure (U1)', () => {
  it('writes no measure in characters by hand', () => {
    const src = resolve(process.cwd(), 'src');
    const offenders = sources(src)
      .map((file) => relative(src, file))
      .filter((file) => file !== 'components/auth/AuthPage.tsx')
      .filter((file) => /\b(?:max-w|w|min-w)-\[\d+ch\]/.test(readFileSync(join(src, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('sets the long texts at the measure: the document analysed, the cards, the lessons', () => {
    for (const file of [
      'components/features/documents/DocumentText.tsx',
      'components/features/studia/CardDetail.tsx',
      'components/features/studia/ReviewCard.tsx',
      'components/features/studia/ValidationQueueView.tsx',
      'components/features/studia/corsi/LessonText.tsx',
    ]) expect(read(file)).toContain('max-w-measure');
  });
});
