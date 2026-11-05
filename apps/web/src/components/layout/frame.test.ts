import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
