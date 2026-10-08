import { collectSearchableText, findMatches, rangesForMatches } from '../findInText';
import { clearFindRanges, setFindRanges } from '../findHighlights';

/** The `Highlight` the tests stub: it keeps its ranges. */
export class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

/**
 * Root rule 23 under a search: opens a find over `root` the way `useFindInText` does (collect, match, ranges, the
 * highlight registry) with `CSS.highlights` and `Highlight` stubbed, and hands back what was drawn. Mount `root` in the
 * document first (the collector reads computed styles). `close()` clears the registry and restores the globals.
 */
export function openFindOn(root: HTMLElement, query: string): { drawn: number; close: () => void } {
  const g = globalThis as unknown as { CSS?: unknown; Highlight?: unknown };
  const saved = { css: g.CSS, highlight: g.Highlight };
  g.CSS = { highlights: new Map() };
  g.Highlight = FakeHighlight;
  const { nodes, text } = collectSearchableText(root);
  const { matches } = findMatches(text, query);
  const ranges = rangesForMatches(nodes, matches);
  setFindRanges('probe', ranges, ranges[0] ?? null);
  return {
    drawn: ranges.length,
    close: () => {
      clearFindRanges('probe');
      g.CSS = saved.css;
      g.Highlight = saved.highlight;
    },
  };
}

/** A query that is surely in the text: its longest word, which a fixture of any size has. */
export function wordOf(plain: string): string {
  const words = plain.match(/\p{L}{3,}/gu) ?? [];
  return words.reduce((best, w) => (w.length > best.length ? w : best), words[0] ?? '');
}
