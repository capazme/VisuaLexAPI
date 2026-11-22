import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderArticleHtml } from '../articleRender';
import { parseArticleStructure } from '../articleStructure';
import { decisionProjection, renderDecisionHtml } from '../decisionRender';
import type { Highlight } from '../../types';
import type { DecisionText } from '../../types/decisions';

// Root rule 23 across repositories (D7b, spec §8.5, §8.10): a passage the assistant proposes is stored by the server
// at an offset in the projection, with the projection's slice, and this renderer must draw exactly those characters.
// The two halves meet in conventions/contract/anchors.json: the server computes each text's passages there
// (apps/server/tests/assistant/ruleTwentyThree.test.ts); here the web draws each one. A passage drawn differently
// here would be an anchor the reader drops silently.

interface Passage { quote: string; start?: number; text?: string; refused?: string }
interface Anchors {
  articles: Array<{ id: string; raw: string; projection: string; passages: Passage[] }>;
  decisions: Array<{ id: string; testo: DecisionText; projection: string; passages: Passage[] }>;
}

function anchors(from: string): Anchors {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'conventions', 'contract', 'anchors.json');
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')) as Anchors;
    if (dirname(dir) === dir) throw new Error('conventions/contract/anchors.json not found above ' + from);
  }
}
const ANCHORS = anchors(__dirname);

const decode = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The characters the renderer wraps in the highlight's marks, in order (a mark split across blocks too). */
function drawn(html: string, id: string): string {
  const re = new RegExp(`<mark[^>]*data-highlight="${id}"[^>]*>([\\s\\S]*?)</mark>`, 'g');
  return [...html.matchAll(re)].map((m) => decode(m[1])).join('');
}

const highlight = (id: string, start: number, text: string): Highlight =>
  ({ id, normaKey: 'k', articleId: '1', text, color: 'yellow', rangeSerialized: '', startOffset: start }) as Highlight;

/** The passages the server stored (a refused quote, `ambiguous`, was stored nowhere). */
const found = (passages: Passage[]) => passages.filter((p) => p.refused === undefined) as Array<{ quote: string; start: number; text: string }>;

describe('rule 23: the web draws every passage of the anchors contract', () => {
  it('has the texts', () => {
    expect(ANCHORS.articles.length).toBeGreaterThan(20);
    expect(ANCHORS.decisions.length).toBeGreaterThan(5);
  });

  it.each(ANCHORS.articles.map((a) => [a.id, a] as const))('article %s', (_id, article) => {
    const passages = found(article.passages);
    expect(passages.length).toBeGreaterThan(0);
    for (const p of passages) {
      const html = renderArticleHtml({ raw: article.raw, structure: parseArticleStructure(article.raw), highlights: [highlight('p1', p.start, p.text)], annotations: [], signs: true });
      expect(drawn(html, 'p1')).toBe(p.text);
    }
  });

  it.each(ANCHORS.decisions.map((d) => [d.id, d] as const))('decision %s', (_id, decision) => {
    // The server's projection is the web's, character for character.
    expect(decisionProjection(decision.testo)).toBe(decision.projection);
    for (const p of found(decision.passages)) {
      const html = renderDecisionHtml({ testo: decision.testo, highlights: [highlight('p1', p.start, p.text)], annotations: [] });
      expect(drawn(html, 'p1')).toBe(p.text);
    }
  });
});
