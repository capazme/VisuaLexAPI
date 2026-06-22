import { describe, it, expect } from 'vitest';
import { buildArticleXrefNerPayload } from './articleXrefNer';
import type { ParsedCitationData } from '../../../utils/citationMatcher';

const citation: ParsedCitationData = {
  act_type: 'codice civile',
  article: '1453',
  act_number: '262',
  date: '1942',
  confidence: 0.6,
};

describe('buildArticleXrefNerPayload (surface: article_xref)', () => {
  it('tags the payload with surface=article_xref and carries the parsed reference', () => {
    const payload = buildArticleXrefNerPayload({
      citation,
      articleUrn: 'urn:nir:stato:codice.civile:1942~art2043',
      articleText: 'Vedi anche art. 1453 c.c. per la risoluzione.',
      matchText: 'art. 1453 c.c.',
      feedbackType: 'confirmation',
    });

    expect(payload.surface).toBe('article_xref');
    expect(payload.feedbackType).toBe('confirmation');
    expect(payload.articleUrn).toBe('urn:nir:stato:codice.civile:1942~art2043');
    expect(payload.selectedText).toBe('art. 1453 c.c.');
    expect(payload.originalParsed).toEqual({
      act_type: 'codice civile',
      act_number: '262',
      date: '1942',
      article: '1453',
      confidence: 0.6,
    });
    expect(payload.confidenceBefore).toBe(0.6);
  });

  it('forwards the correction reference', () => {
    const payload = buildArticleXrefNerPayload({
      citation,
      articleText: 'art. 1453 c.c.',
      matchText: 'art. 1453 c.c.',
      feedbackType: 'correction',
      correctReference: { actType: 'codice penale', article: '624' },
    });

    expect(payload.feedbackType).toBe('correction');
    expect(payload.correctReference).toEqual({ actType: 'codice penale', article: '624' });
  });

  it('strips HTML and respects the ±500 char privacy budget around the citation', () => {
    const before = 'a'.repeat(800);
    const after = 'b'.repeat(800);
    const matchText = 'art. 1453 c.c.';
    const articleText = `<p>${before}${matchText}${after}</p>`;

    const payload = buildArticleXrefNerPayload({
      citation,
      articleText,
      matchText,
      feedbackType: 'confirmation',
    });

    expect(payload.contextWindow).toBeDefined();
    // 500 before + match + 500 after = 1000 + match length, well under the 1200 BFF cap.
    expect(payload.contextWindow!.length).toBe(500 + matchText.length + 500);
    expect(payload.contextWindow!.startsWith('a')).toBe(true);
    expect(payload.contextWindow!.endsWith('b')).toBe(true);
    expect(payload.contextWindow).not.toContain('<');
  });

  it('omits the context window when the citation text is not locatable', () => {
    const payload = buildArticleXrefNerPayload({
      citation,
      articleText: 'Testo che non contiene la citazione.',
      matchText: '',
      feedbackType: 'false_positive',
    });

    expect(payload.contextWindow).toBeUndefined();
    expect(payload.selectedText).toBeUndefined();
  });
});
