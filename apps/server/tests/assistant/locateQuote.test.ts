import { describe, expect, it } from 'vitest';
import { locateQuote } from '../../src/assistant/locateQuote';

// D7b, spec §8.5: the words the model quotes, found in the projection; the slice is the text's own.
const TEXT =
  "Nei contratti con prestazioni corrispettive, quando uno dei contraenti non adempie le sue obbligazioni, l'altro può a sua scelta chiedere l'adempimento o la risoluzione del contratto, salvo, in ogni caso, il risarcimento del danno. La risoluzione può essere domandata anche quando il giudizio è stato promosso per ottenere l'adempimento.";

describe('locateQuote', () => {
  it('finds one occurrence and returns the text’s own slice at its offset', () => {
    const got = locateQuote(TEXT, { testo: 'il risarcimento del danno' });
    expect(got).toEqual({ found: true, start: TEXT.indexOf('il risarcimento del danno'), text: 'il risarcimento del danno' });
  });

  it('matches a run of whitespace with a run of whitespace, or with nothing', () => {
    const spaced = 'Art. 1.  Primo comma.Secondo   comma della norma che continua.';
    const a = locateQuote(spaced, { testo: 'Primo comma. Secondo comma della norma' });
    expect(a).toMatchObject({ found: true, start: spaced.indexOf('Primo'), text: 'Primo comma.Secondo   comma della norma' });
    // A line break the model kept, which the projection removed.
    const b = locateQuote(TEXT, { testo: 'la risoluzione\ndel contratto, salvo' });
    expect(b).toMatchObject({ found: true, text: 'la risoluzione del contratto, salvo' });
    // The edges of the quote are not part of the slice.
    expect(locateQuote(TEXT, { testo: '  il risarcimento del danno \n' })).toMatchObject({ found: true, text: 'il risarcimento del danno' });
  });

  it('never matches words the text splits: «infine» is not «in fine»', () => {
    const t = 'la parte si riserva in fine di agire per il risarcimento del danno subito.';
    expect(locateQuote(t, { testo: 'si riserva infine di agire' })).toEqual({ found: false, reason: 'not_found' });
    expect(locateQuote(t, { testo: 'si riserva in fine di agire' })).toMatchObject({ found: true });
  });

  it('counts case, accents, apostrophes and quotation marks as written', () => {
    expect(locateQuote(TEXT, { testo: 'IL RISARCIMENTO DEL DANNO' })).toEqual({ found: false, reason: 'not_found' });
    expect(locateQuote(TEXT, { testo: "l'altro puo a sua scelta" })).toEqual({ found: false, reason: 'not_found' });
    expect(locateQuote(TEXT, { testo: 'l’altro può a sua scelta' })).toEqual({ found: false, reason: 'not_found' });
    expect(locateQuote(TEXT, { testo: "l'altro può a sua scelta" })).toMatchObject({ found: true });
  });

  it('refuses a quote too short to choose a place', () => {
    expect(locateQuote(TEXT, { testo: 'il danno' })).toEqual({ found: false, reason: 'too_short' });
    expect(locateQuote(TEXT, { testo: ' a  b  c  d  e  f  g ' })).toEqual({ found: false, reason: 'too_short' });
  });

  it('chooses among several occurrences with the words before or after, compared the same way', () => {
    const quote = { testo: "ottenere l'adempimento" };
    const twice = `${TEXT} Il giudice può ottenere l'adempimento coattivo.`;
    expect(locateQuote(twice, quote)).toEqual({ found: false, reason: 'ambiguous', count: 2 });
    const before = locateQuote(twice, { ...quote, prima: 'stato promosso per' });
    expect(before).toMatchObject({ found: true, start: twice.indexOf("ottenere l'adempimento") });
    const after = locateQuote(twice, { ...quote, dopo: 'coattivo' });
    expect(after).toMatchObject({ found: true, start: twice.lastIndexOf("ottenere l'adempimento") });
    // Context that touches neither, or both: still the count.
    expect(locateQuote(twice, { ...quote, prima: 'nessuna parola qui' })).toEqual({ found: false, reason: 'ambiguous', count: 2 });
    const thrice = `x ottenere l'adempimento y ottenere l'adempimento y`;
    expect(locateQuote(thrice, { ...quote, dopo: 'y' })).toEqual({ found: false, reason: 'ambiguous', count: 2 });
  });

  it('spans two commi, as a user’s highlight may', () => {
    const t = 'Primo comma che finisce qui.Secondo comma che comincia qui.';
    expect(locateQuote(t, { testo: 'che finisce qui.\n\nSecondo comma' })).toMatchObject({ found: true, text: 'che finisce qui.Secondo comma' });
  });

  it('counts overlapping occurrences', () => {
    const t = 'abab abab abab abab abab abab';
    expect(locateQuote(t, { testo: 'abab abab abab abab' })).toEqual({ found: false, reason: 'ambiguous', count: 3 });
  });

  it('treats the characters of a regular expression as text', () => {
    const t = 'Si applica l’art. 2 (o 3) [comma 1] al caso: 10.000,00 € * 2 = ?';
    expect(locateQuote(t, { testo: '(o 3) [comma 1] al caso: 10.000,00 € * 2' })).toMatchObject({ found: true });
  });

  it('stays linear on a long text', () => {
    const long = 'parola '.repeat(40_000) + 'il risarcimento del danno';
    const started = Date.now();
    expect(locateQuote(long, { testo: 'il risarcimento del danno' })).toMatchObject({ found: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
