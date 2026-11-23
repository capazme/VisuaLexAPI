import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchorsPath, computeAnchors, serializeAnchors, type Anchors, type Passage } from './anchorsContract';

// D7b (spec §8.5, §8.10) and root rule 23: a passage proposed on a real text is stored at an offset in the renderer's
// projection, with the projection's slice; the web's renderer then draws exactly those characters. The two halves meet
// in conventions/contract/anchors.json: here, the server computes each text's projection and passages from the file's
// frozen texts; the web's anchorsContract.test.ts checks that it draws each passage there. A difference here means the
// server moved: rewrite the file (conventions/contract/README.md) and let the web's suite judge the new passages.

const file = anchorsPath();
const written = readFileSync(file, 'utf8');
const stored = JSON.parse(written) as Anchors;
const computed = computeAnchors(stored);

const found = (passages: Passage[]) => passages.filter((p) => p.refused === undefined);

describe('rule 23: the anchors contract is what the server computes', () => {
  it('has the texts', () => {
    expect(stored.articles.length).toBeGreaterThan(20);
    expect(stored.decisions.length).toBeGreaterThan(5);
  });

  it.each(stored.articles.map((a, i) => [a.id, i] as const))('article %s', (_id, i) => {
    const article = stored.articles[i];
    expect(computed.articles[i]).toEqual(article);
    for (const p of article.passages) {
      // A quote that repeats in the text is refused, never stored somewhere else.
      if (p.refused !== undefined) expect(p.refused).toBe('ambiguous');
      else expect(article.projection.slice(p.start, p.start! + p.text!.length)).toBe(p.text);
    }
    expect(found(article.passages).length).toBeGreaterThan(0);
  });

  it.each(stored.decisions.map((d, i) => [d.id, i] as const))('decision %s', (_id, i) => {
    const decision = stored.decisions[i];
    expect(computed.decisions[i]).toEqual(decision);
    for (const p of found(decision.passages)) expect(decision.projection.slice(p.start, p.start! + p.text!.length)).toBe(p.text);
    // A decision withheld has no text: the server refuses to propose on it (`readEntryText`).
    expect(found(decision.passages).length > 0 || decision.projection === '').toBe(true);
  });

  it('is written as the server writes it', () => {
    expect(written).toBe(serializeAnchors(computed));
  });
});
