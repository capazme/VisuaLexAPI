import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { articleProjection, decisionProjection, stripEdges, type DecisionText } from '../../src/assistant/entryText';
import { locateQuote } from '../../src/assistant/locateQuote';

/**
 * Rule 23 (root CLAUDE.md) across repositories: `conventions/contract/anchors.json`. Its texts (`raw`, `testo`) are
 * inputs, frozen; its `projection` and `passages` are what this module computes from them with the server's code. The
 * web's `anchorsContract.test.ts` checks that its renderer draws each passage's text at its start, so the server and
 * the web meet in the file instead of importing each other (conventions/contract/README.md).
 */
export interface Passage {
  quote: string;
  start?: number;
  text?: string;
  refused?: string;
}
export interface ArticleCase {
  id: string;
  raw: string;
  projection: string;
  passages: Passage[];
}
export interface DecisionCase {
  id: string;
  testo: DecisionText;
  projection: string;
  passages: Passage[];
}
export interface Anchors {
  version: number;
  note: string;
  articles: ArticleCase[];
  decisions: DecisionCase[];
}

export function anchorsPath(from: string = __dirname): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'conventions', 'contract', 'anchors.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('conventions/contract/anchors.json not found above ' + from);
  }
}

/** Quotes taken from the text the model reads (with its line breaks and spacing), at a few places. */
export function quotesFrom(display: string, projection: string): string[] {
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

function passage(projection: string, quote: string, asked: string): Passage {
  const got = locateQuote(projection, { testo: asked });
  return got.found ? { quote, start: got.start, text: got.text } : { quote, refused: got.reason };
}

/** The file as the server would write it from the stored texts. */
export function computeAnchors(stored: Anchors): Anchors {
  return {
    version: stored.version,
    note: stored.note,
    articles: stored.articles.map(({ id, raw }) => {
      const projection = articleProjection(raw);
      return { id, raw, projection, passages: quotesFrom(raw, projection).map((q) => passage(projection, q, q)) };
    }),
    decisions: stored.decisions.map(({ id, testo }) => {
      const projection = decisionProjection(testo);
      // The blocks as the projection counts them, with their line breaks: what the model reads, block by block.
      const display = (['epigrafe', 'motivazione', 'dispositivo'] as const).map((k) => stripEdges(testo[k] ?? '')).join('');
      return { id, testo, projection, passages: quotesFrom(display, projection).map((q) => passage(projection, q, q.replace(/\s+/g, ' '))) };
    }),
  };
}

// Characters a diff or an editor would hide or normalise (no-break and other special spaces, soft hyphen, line and
// paragraph separators, zero-width ones, the byte order mark) are written as \u escapes: JSON reads them back the same.
const INVISIBLE = /[\x80-\xa0\xad\u{2000}-\u{200f}\u{2028}-\u{202f}\u{205f}-\u{206f}\u{feff}]/gu;

export function serializeAnchors(anchors: Anchors): string {
  return JSON.stringify(anchors, null, 2).replace(INVISIBLE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
}
