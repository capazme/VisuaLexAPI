import { describe, expect, it } from 'vitest';
import { articleProjection, decisionProjection, stripEdges } from '../../src/assistant/entryText';
import { locateQuote } from '../../src/assistant/locateQuote';
// The web's own renderer and fixtures (root rule 23): what the server stores must be what the reader draws.
import { ARTICLE_FIXTURES } from '../../../web/src/utils/__fixtures__/articleTexts';
import { READER_TEXTS } from '../../../web/src/utils/__fixtures__/decisionTexts';
import { renderArticleHtml } from '../../../web/src/utils/articleRender';
import { parseArticleStructure } from '../../../web/src/utils/articleStructure';
import { decisionProjection as webDecisionProjection, renderDecisionHtml } from '../../../web/src/utils/decisionRender';
import type { Highlight } from '../../../web/src/types';

// D7b (spec §8.5, §8.10): a passage proposed on a real text is stored at an offset in the renderer's
// projection, with the projection's slice; the web's renderer then draws exactly those characters.

const decode = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The characters the renderer wraps in the highlight's marks, in order (a mark split across blocks too). */
function drawn(html: string, id: string): string {
  const re = new RegExp(`<mark[^>]*data-highlight="${id}"[^>]*>([\\s\\S]*?)</mark>`, 'g');
  return [...html.matchAll(re)].map((m) => decode(m[1])).join('');
}

/** Quotes taken from the text the model reads (with its line breaks and spacing), at a few places. */
function quotesFrom(display: string, projection: string): string[] {
  const out: string[] = [];
  for (const fraction of [0.15, 0.45, 0.8]) {
    // Start at a word in the projection, take about 60 characters, and quote them from the display text.
    let start = Math.floor(projection.length * fraction);
    while (start > 0 && !/\s/.test(projection[start - 1])) start--;
    const end = Math.min(projection.length, start + 60);
    if (end - start < 20) continue;
    // Map projection offsets back to the display text (which only has extra \n).
    const at: number[] = [];
    for (let i = 0; i < display.length; i++) if (display[i] !== '\n') at.push(i);
    out.push(display.slice(at[start], at[end - 1] + 1));
  }
  return out;
}

const highlight = (id: string, start: number, text: string): Highlight =>
  ({ id, normaKey: 'k', articleId: '1', text, color: 'yellow', rangeSerialized: '', startOffset: start }) as Highlight;

describe('rule 23: a proposed passage lands where the web draws it', () => {
  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))('article %s', (_id, raw) => {
    const projection = articleProjection(raw);
    let checked = 0;
    for (const quote of quotesFrom(raw, projection)) {
      const got = locateQuote(projection, { testo: quote });
      if (!got.found) {
        // A quote that repeats in the text is refused, never stored somewhere else.
        expect(got.reason).toBe('ambiguous');
        continue;
      }
      expect(projection.slice(got.start, got.start + got.text.length)).toBe(got.text);
      const html = renderArticleHtml({ raw, structure: parseArticleStructure(raw), highlights: [highlight('p1', got.start, got.text)], annotations: [], signs: true });
      expect(drawn(html, 'p1')).toBe(got.text);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it.each(Object.entries(READER_TEXTS))('decision %s', (_id, testo) => {
    const projection = decisionProjection(testo);
    // The server's projection is the web's, character for character.
    expect(projection).toBe(webDecisionProjection(testo));
    // The blocks as the projection counts them, with their line breaks: what the model reads, block by block.
    const display = (['epigrafe', 'motivazione', 'dispositivo'] as const).map((k) => stripEdges(testo[k] ?? '')).join('');
    let checked = 0;
    for (const quote of quotesFrom(display, projection)) {
      const got = locateQuote(projection, { testo: quote.replace(/\s+/g, ' ') });
      if (!got.found) continue;
      const html = renderDecisionHtml({ testo, highlights: [highlight('p1', got.start, got.text)], annotations: [] });
      expect(drawn(html, 'p1')).toBe(got.text);
      checked++;
    }
    // A decision withheld has no text: the server refuses to propose on it (`readEntryText`).
    expect(checked > 0 || projection === '').toBe(true);
  });
});
