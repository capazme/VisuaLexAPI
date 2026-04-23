import { describe, it, expect } from 'vitest';
import { extractPreamble } from './extractPreamble';

describe('extractPreamble', () => {
  it('splits article + rubric + body and reports the consumed offset', () => {
    const raw =
      'art. 100.\n\n(Interesse ad agire).\n\nPer proporre una domanda o per contradire alla stessa è necessario avervi interesse.';
    const r = extractPreamble(raw);
    expect(r.rubric).toBe('Interesse ad agire');
    expect(r.body.startsWith('Per proporre')).toBe(true);
    expect(raw.slice(r.offset)).toBe(r.body);
  });

  it('handles a rubric that sits on the same line as the article number', () => {
    const raw =
      'Art. 2043.\n(Risarcimento per fatto illecito).\nQualunque fatto doloso.';
    const r = extractPreamble(raw);
    expect(r.rubric).toBe('Risarcimento per fatto illecito');
    expect(r.body.startsWith('Qualunque fatto')).toBe(true);
  });

  it('recognises "bis" / "ter" numbering suffixes', () => {
    expect(extractPreamble('art. 100 bis.\n(Edge case).\nTesto.').rubric).toBe('Edge case');
    expect(extractPreamble('art. 50-ter.\n(Con trattino).\nCorpo.').rubric).toBe('Con trattino');
  });

  it('returns the full text when no preamble is present', () => {
    const raw = 'Testo che non inizia con art.';
    const r = extractPreamble(raw);
    expect(r).toEqual({ rubric: null, body: raw, offset: 0, plainOffset: 0 });
  });

  it('handles articles without a rubric', () => {
    const raw = 'art. 1.\nTesto senza rubrica.';
    const r = extractPreamble(raw);
    expect(r.rubric).toBeNull();
    expect(r.body).toBe('Testo senza rubrica.');
    expect(r.offset).toBeGreaterThan(0);
  });

  it('leaves the text alone when the preamble would consume everything', () => {
    // Guard: if the match covers the whole text we'd render an empty
    // body — better to keep the raw text so the article doesn't disappear.
    const raw = 'art. 42.';
    const r = extractPreamble(raw);
    expect(r).toEqual({ rubric: null, body: raw, offset: 0, plainOffset: 0 });
  });

  it('returns zero offset on empty input', () => {
    const r = extractPreamble('');
    expect(r).toEqual({ rubric: null, body: '', offset: 0, plainOffset: 0 });
  });

  it('reports a plainOffset that excludes newlines consumed by the preamble', () => {
    // Regression: shifting highlight offsets by `offset` (raw) rather than
    // `plainOffset` skewed the stored startOffset by one per newline in
    // the preamble, so a highlight made in Study Mode landed on the wrong
    // span in the main article view.
    const raw = 'art. 100.\n\n(Interesse).\n\nPer proporre una domanda.';
    const r = extractPreamble(raw);
    expect(r.offset).toBe(25);      // raw chars consumed (includes 4 newlines)
    expect(r.plainOffset).toBe(21); // 25 - 4 newlines
  });

  it('plainOffset equals offset when the preamble has no newlines', () => {
    const raw = 'Art. 2043. (Risarcimento). Qualunque fatto.';
    const r = extractPreamble(raw);
    expect(r.offset).toBe(r.plainOffset);
  });
});
