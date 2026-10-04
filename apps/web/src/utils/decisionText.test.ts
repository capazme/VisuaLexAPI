import { describe, expect, it } from 'vitest';
import { decisionParagraphs, hasDecisionText } from './decisionText';

describe('decisionParagraphs', () => {
  it('groups lines at empty lines and drops only the newlines', () => {
    const text = 'LA CORTE\nSUPREMA DI CASSAZIONE\n\n  ha pronunciato\nla seguente\n\n\nORDINANZA';
    const paragraphs = decisionParagraphs(text);
    expect(paragraphs).toEqual([['LA CORTE', 'SUPREMA DI CASSAZIONE'], ['  ha pronunciato', 'la seguente'], ['ORDINANZA']]);
    expect(paragraphs.flat().join('')).toBe(text.replaceAll('\n', ''));
  });

  it('keeps the space that ends a paragraph the server restored with a blank line', () => {
    const text = 'Premessa. \n\nFATTI DI CAUSA Il fatto. \n\nP.Q.M. Rigetta.';
    const paragraphs = decisionParagraphs(text);
    expect(paragraphs).toEqual([['Premessa. '], ['FATTI DI CAUSA Il fatto. '], ['P.Q.M. Rigetta.']]);
    expect(paragraphs.flat().join('')).toBe(text.replaceAll('\n', ''));
  });
});

describe('hasDecisionText', () => {
  it('is false only for the empty text of a decision found without it', () => {
    expect(hasDecisionText({})).toBe(false);
    expect(hasDecisionText({ dispositivo: 'dichiara' })).toBe(true);
    // an ordinanza whose epigrafe has no «Ritenuto» line comes without a motivazione
    expect(hasDecisionText({ epigrafe: 'ha pronunciato la seguente' })).toBe(true);
  });
});
