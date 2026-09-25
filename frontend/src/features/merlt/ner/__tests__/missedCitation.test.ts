import { describe, it, expect } from 'vitest';
import { buildMissedNerPayload, MISSED_CONTEXT_MAX } from '../missedCitation';

/** Offset of `needle` in the marker projection (article_text without '\n'), as SelectionPopup reports it. */
function plainOffset(articleText: string, needle: string): number {
  return articleText.replace(/\n/g, '').indexOf(needle);
}

describe('buildMissedNerPayload (surface=article_xref, feedbackType=missed)', () => {
  const article =
    'Art. 1453\nRisolubilità del contratto per inadempimento.\n' +
    'Nei contratti con prestazioni corrispettive, quando uno dei contraenti non adempie, ' +
    "si applica quanto previsto dall'articolo 1218 del codice civile.\nComma secondo.";

  it('tags the payload as a missed article_xref report with the correct reference', () => {
    const payload = buildMissedNerPayload({
      articleUrn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
      articleText: article,
      selectedText: 'articolo 1218 del codice civile',
      startOffset: plainOffset(article, 'articolo 1218'),
      actType: ' codice civile ',
      article: '1218',
    });
    expect(payload).toMatchObject({
      surface: 'article_xref',
      feedbackType: 'missed',
      articleUrn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
      selectedText: 'articolo 1218 del codice civile',
      correctReference: {
        actType: 'codice civile',
        article: '1218',
        displayText: 'articolo 1218 del codice civile',
      },
    });
  });

  it('keeps offsets in the projection where only newlines are invisible', () => {
    const start = plainOffset(article, 'articolo 1218');
    const payload = buildMissedNerPayload({
      articleText: article,
      selectedText: 'articolo 1218 del codice civile',
      startOffset: start,
      actType: 'codice civile',
      article: '1218',
    });
    expect(payload.startOffset).toBe(start);
    expect(payload.endOffset).toBe(start + 'articolo 1218 del codice civile'.length);
    // Two line breaks precede the span: a naive raw slice would be off by two.
    expect(article.slice(start, start + 8)).not.toBe('articolo');
  });

  it('cuts the context window from the raw text so the span can be found in it', () => {
    const payload = buildMissedNerPayload({
      articleText: article,
      selectedText: 'articolo 1218 del codice civile',
      startOffset: plainOffset(article, 'articolo 1218'),
      actType: 'codice civile',
      article: '1218',
    });
    expect(payload.contextWindow).toBeDefined();
    expect(payload.contextWindow!.includes(payload.selectedText!)).toBe(true);
    expect(payload.contextWindow!.startsWith('Art. 1453')).toBe(true);
  });

  it('handles a selection that spans a line break (Selection.toString emits \\n for <br>)', () => {
    const selected = "codice civile.\nComma";
    const payload = buildMissedNerPayload({
      articleText: article,
      selectedText: selected,
      startOffset: plainOffset(article, 'codice civile.Comma'),
      actType: 'codice civile',
      article: '1218',
    });
    expect(payload.selectedText).toBe(selected);
    expect(payload.endOffset! - payload.startOffset!).toBe('codice civile.Comma'.length);
    expect(payload.contextWindow!.includes(selected)).toBe(true);
  });

  it('never sends more than the privacy budget of context', () => {
    const long = `${'a'.repeat(2000)} art. 7 del d.lgs. 196/2003 ${'b'.repeat(2000)}`;
    const payload = buildMissedNerPayload({
      articleText: long,
      selectedText: 'art. 7 del d.lgs. 196/2003',
      startOffset: long.indexOf('art. 7'),
      actType: 'd.lgs.',
      article: '7',
    });
    expect(payload.contextWindow!.length).toBeLessThanOrEqual(MISSED_CONTEXT_MAX);
    expect(payload.contextWindow!.includes('art. 7 del d.lgs. 196/2003')).toBe(true);
  });

  it('falls back to the first occurrence when the offset no longer matches the text', () => {
    const payload = buildMissedNerPayload({
      articleText: article,
      selectedText: 'articolo 1218',
      startOffset: 3,
      actType: 'codice civile',
      article: '1218',
    });
    expect(payload.contextWindow!.includes('articolo 1218')).toBe(true);
  });

  it('sends no context when the selection is not in the article text', () => {
    const payload = buildMissedNerPayload({
      articleText: article,
      selectedText: 'art. 5 della legge 241/1990',
      startOffset: 10,
      actType: 'legge',
      article: '5',
    });
    expect(payload.contextWindow).toBeUndefined();
    expect(payload.selectedText).toBe('art. 5 della legge 241/1990');
  });
});
