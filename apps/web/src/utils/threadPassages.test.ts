// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  plainText,
  textFingerprint,
  buildPassage,
  locatePassage,
} from './threadPassages';
import { ARTICLE_FIXTURES, fixtureText } from './__fixtures__/articleTexts';

describe('plainText', () => {
  it('strips all newline characters from text', () => {
    expect(plainText('a\nb\n\nc')).toBe('abc');
  });
});

describe('textFingerprint', () => {
  it('computes lowercase hex SHA-256 matching known hashes and ignoring line breaks', async () => {
    const hashAbc = await textFingerprint('abc');
    expect(hashAbc).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    const hashAbcWithNewlines = await textFingerprint('a\nb\nc');
    expect(hashAbcWithNewlines).toBe(hashAbc);

    const hashEmpty = await textFingerprint('');
    expect(hashEmpty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('buildPassage', () => {
  const plainCc1453 = plainText(fixtureText('nrm-cc-1453'));

  it('builds passage with 32 characters of context in the middle of text', () => {
    const quote = 'inadempimento';
    const start = plainCc1453.indexOf(quote);
    expect(start).toBeGreaterThan(0);
    expect(plainCc1453.startsWith(quote, start)).toBe(true);

    const passage = buildPassage(plainCc1453, start, quote);
    expect(passage).not.toBeNull();
    expect(passage!.quote).toBe(quote);
    expect(passage!.start).toBe(start);
    expect(passage!.prefix).toHaveLength(32);
    expect(passage!.suffix).toHaveLength(32);
  });

  it('bounds prefix and suffix at text boundaries', () => {
    // Near start
    const startNear0 = 0;
    const quoteStart = plainCc1453.slice(0, 10);
    const pStart = buildPassage(plainCc1453, startNear0, quoteStart);
    expect(pStart).not.toBeNull();
    expect(pStart!.prefix).toBe('');
    expect(pStart!.suffix).toHaveLength(32);

    // Near end
    const quoteEnd = plainCc1453.slice(plainCc1453.length - 10);
    const startNearEnd = plainCc1453.length - 10;
    const pEnd = buildPassage(plainCc1453, startNearEnd, quoteEnd);
    expect(pEnd).not.toBeNull();
    expect(pEnd!.prefix).toHaveLength(32);
    expect(pEnd!.suffix).toBe('');
  });

  it('returns null when quote is not at start offset', () => {
    const passage = buildPassage(plainCc1453, 50, 'non-existing-quote');
    expect(passage).toBeNull();
  });

  it('returns null when quote is empty or whitespace only', () => {
    expect(buildPassage(plainCc1453, 0, '')).toBeNull();
    expect(buildPassage(plainCc1453, 0, '   ')).toBeNull();
  });

  it('returns null when quote exceeds 2000 characters', () => {
    const longQuote = 'x'.repeat(2001);
    expect(buildPassage(longQuote, 0, longQuote)).toBeNull();
  });
});

describe('locatePassage', () => {
  const plainCc1453 = plainText(fixtureText('nrm-cc-1453'));

  it('returns exact when passage is at original offset in unchanged text', () => {
    const quote = 'risoluzione';
    const start = plainCc1453.indexOf(quote);
    const passage = buildPassage(plainCc1453, start, quote)!;

    const loc = locatePassage(plainCc1453, passage);
    expect(loc).toEqual({
      state: 'exact',
      start,
      end: start + quote.length,
    });
  });

  it('returns moved with shifted offset when text is prepended', () => {
    const quote = 'risoluzione';
    const start = plainCc1453.indexOf(quote);
    const passage = buildPassage(plainCc1453, start, quote)!;

    const prefixAddition = 'Premessa aggiunta. ';
    const modifiedText = prefixAddition + plainCc1453;

    const loc = locatePassage(modifiedText, passage);
    expect(loc).toEqual({
      state: 'moved',
      start: start + prefixAddition.length,
      end: start + quote.length + prefixAddition.length,
    });
  });

  it('returns moved when internal whitespace in quoted words changes', () => {
    const quote = 'risoluzione del contratto';
    const start = plainCc1453.indexOf(quote);
    const passage = buildPassage(plainCc1453, start, quote)!;

    // Change one space inside the quoted words to two spaces
    const modifiedText = plainCc1453.replace('risoluzione del contratto', 'risoluzione  del contratto');

    const loc = locatePassage(modifiedText, passage);
    expect(loc.state).toBe('moved');
    if (loc.state === 'moved') {
      expect(loc.start).toBe(start);
      expect(loc.end).toBe(start + quote.length + 1); // 1 extra space
    }
  });

  it('returns detached when quoted words are completely deleted', () => {
    const quote = 'risoluzione';
    const start = plainCc1453.indexOf(quote);
    const passage = buildPassage(plainCc1453, start, quote)!;

    const modifiedText = plainCc1453.replaceAll(quote, '');
    const loc = locatePassage(modifiedText, passage);
    expect(loc).toEqual({ state: 'detached' });
  });

  it('locates repeated word at the correct occurrence using context when text before it changes', () => {
    // Pick the second occurrence of 'risoluzione'
    const quote = 'risoluzione';
    const firstIndex = plainCc1453.indexOf(quote);
    const secondIndex = plainCc1453.indexOf(quote, firstIndex + quote.length);
    expect(secondIndex).toBeGreaterThan(firstIndex);

    const passage = buildPassage(plainCc1453, secondIndex, quote)!;

    const prefixAddition = 'Nuovo inizio testo. ';
    const modifiedText = prefixAddition + plainCc1453;

    const loc = locatePassage(modifiedText, passage);
    expect(loc).toEqual({
      state: 'moved',
      start: secondIndex + prefixAddition.length,
      end: secondIndex + quote.length + prefixAddition.length,
    });
  });

  it('returns detached when repeated word matches context with score < MIN_CONTEXT_MATCH', () => {
    const passage = {
      quote: 'risoluzione',
      start: 9999,
      prefix: 'xxxxxxxxxxxx',
      suffix: 'yyyyyyyyyyyy',
    };
    const loc = locatePassage(plainCc1453, passage);
    expect(loc).toEqual({ state: 'detached' });
  });

  it('returns detached when two occurrences tie with equal context score', () => {
    const text = 'aaaaaaaaaa contratto bbbbbbbbbb | aaaaaaaaaa contratto bbbbbbbbbb';
    const passage = {
      quote: 'contratto',
      start: 500,
      prefix: 'aaaaaaaaaa ',
      suffix: ' bbbbbbbbbb',
    };
    const loc = locatePassage(text, passage);
    expect(loc).toEqual({ state: 'detached' });
  });

  it('returns detached when capitalisation in quoted words changed', () => {
    const quote = 'risoluzione';
    const start = plainCc1453.indexOf(quote);
    const passage = buildPassage(plainCc1453, start, quote)!;

    // Change 'risoluzione' to 'Risoluzione'
    const modifiedText = plainCc1453.slice(0, start) + 'R' + plainCc1453.slice(start + 1);

    const loc = locatePassage(modifiedText, passage);
    expect(loc).toEqual({ state: 'detached' });
  });

  it('returns detached when quote consists only of whitespace', () => {
    const passage = {
      quote: '   ',
      start: 10,
      prefix: 'abc',
      suffix: 'def',
    };
    const loc = locatePassage(plainCc1453, passage);
    expect(loc).toEqual({ state: 'detached' });
  });
});

describe('fixtures round-trip test', () => {
  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))(
    '%s: round-trips 20-character passages at 25%, 50%, 75% to exact',
    (_id, rawText) => {
      const plain = plainText(rawText);
      const percentages = [0.25, 0.5, 0.75];

      for (const pct of percentages) {
        let targetIdx = Math.floor(plain.length * pct);
        // Advance to next non-whitespace character
        while (targetIdx < plain.length && /\s/.test(plain[targetIdx])) {
          targetIdx++;
        }
        if (targetIdx + 20 <= plain.length) {
          const quote = plain.slice(targetIdx, targetIdx + 20);
          const passage = buildPassage(plain, targetIdx, quote);
          expect(passage).not.toBeNull();
          const loc = locatePassage(plain, passage!);
          expect(loc).toEqual({
            state: 'exact',
            start: targetIdx,
            end: targetIdx + 20,
          });
        }
      }
    }
  );
});
