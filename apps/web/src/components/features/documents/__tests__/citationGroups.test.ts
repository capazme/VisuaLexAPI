import { describe, expect, it } from 'vitest';
import { extractCitations } from '../../../../utils/citationMatcher';
import { citedPassage, citationCountLabel, groupCitationsByAct, RECOGNISED_EXAMPLES } from '../citationGroups';
import { PARERE } from './fixtures';

describe('groupCitationsByAct', () => {
  const citations = extractCitations(PARERE);
  const groups = groupCitationsByAct(PARERE, citations);

  it('groups by act, in the order the acts first appear', () => {
    expect(groups.map(g => [g.heading, g.entries.length])).toEqual([
      ['Codice civile', 4],
      ['l. 241/1990', 2],
    ]);
  });

  it('keeps every citation exactly once, in the order of the text within its act', () => {
    const indices = groups.flatMap(g => g.entries.map(e => e.index));
    expect([...indices].sort((a, b) => a - b)).toEqual(citations.map((_, i) => i));
    for (const group of groups) {
      const starts = group.entries.map(e => e.citation.startIndex);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    }
  });

  it('names each entry by its article alone', () => {
    expect(groups[0].entries.map(e => e.article)).toEqual(['art. 1453', 'art. 1455', 'art. 2043', 'art. 1453']);
    expect(groups[1].entries.map(e => e.article)).toEqual(['art. 3', 'art. 7']);
  });

  it('puts «l. 241/1990» and «l. 241/90» in the same act', () => {
    expect(new Set(groups[1].entries.map(e => e.citation.parsed.date))).toEqual(new Set(['1990']));
  });

  it('keeps acts of the same type and different numbers apart', () => {
    const text = 'la legge 241/1990 art. 3 e la legge 689/1981 art. 14';
    const apart = groupCitationsByAct(text, extractCitations(text));
    expect(apart.map(g => g.heading)).toEqual(['l. 241/1990', 'l. 689/1981']);
  });

  it('returns no group for no citation', () => {
    expect(groupCitationsByAct('Nessun riferimento qui.', [])).toEqual([]);
  });

  it('holds 400 citations without losing one', () => {
    const many = Array.from({ length: 400 }, (_, i) => `Punto ${i}: art. ${i + 1} c.c.`).join('\n');
    const found = extractCitations(many);
    expect(found).toHaveLength(400);
    const grouped = groupCitationsByAct(many, found);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].entries).toHaveLength(400);
  });
});

describe('citedPassage', () => {
  it('quotes the citation with what surrounds it on its line', () => {
    const [citation] = extractCitations(PARERE);
    const passage = citedPassage(PARERE, citation.startIndex, citation.endIndex);
    expect(passage.match).toBe(citation.text);
    expect(passage.before).toBe("Il fornitore invoca l'");
    expect(passage.after.startsWith(' e, in subordine,')).toBe(true);
  });

  it('never crosses a line break', () => {
    const text = 'riga prima\nart. 2043 c.c.\nriga dopo';
    const [citation] = extractCitations(text);
    const passage = citedPassage(text, citation.startIndex, citation.endIndex);
    expect(passage).toMatchObject({ before: '', after: '', cutBefore: false, cutAfter: false });
  });

  it('cuts a long line on both sides, at a word, and says so', () => {
    const words = 'parola '.repeat(40);
    const text = `${words}art. 2043 c.c. ${words}`;
    const [citation] = extractCitations(text);
    const passage = citedPassage(text, citation.startIndex, citation.endIndex);
    expect(passage.cutBefore).toBe(true);
    expect(passage.cutAfter).toBe(true);
    expect(passage.before.length).toBeLessThanOrEqual(48);
    expect(passage.after.length).toBeLessThanOrEqual(80);
    expect(passage.before.startsWith('parola')).toBe(true);
    expect(passage.after.trimEnd().endsWith('parola')).toBe(true);
  });

  it('shows a run of spaces or a tab as one space, in the list only', () => {
    const text = 'vedi\t\tl’art.  2043 c.c.   ora';
    const [citation] = extractCitations(text);
    const passage = citedPassage(text, citation.startIndex, citation.endIndex);
    expect(passage.before).toBe('vedi l’');
    expect(passage.after).toBe(' ora');
  });
});

describe('citationCountLabel', () => {
  it('counts in Italian, singular and plural', () => {
    expect(citationCountLabel(12, 5)).toBe('12 citazioni in 5 atti');
    expect(citationCountLabel(1, 1)).toBe('1 citazione in 1 atto');
    expect(citationCountLabel(3, 1)).toBe('3 citazioni in 1 atto');
  });
});

describe('RECOGNISED_EXAMPLES', () => {
  it('are all recognised, each as one citation', () => {
    for (const example of RECOGNISED_EXAMPLES) {
      expect(extractCitations(example), example).toHaveLength(1);
    }
  });
});
