import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatParsedCitation, isSearchReady, parseLegalCitation, toSearchParams, type ParsedCitation } from '../citationParser';
import { citeNorm, shortNorm, type LabelledNorm } from '../sources';
import { ACT_TYPES } from '../sources/actTypes';

// Every label the source convention writes, typed into the palette, names the norm it was
// written from (conventions/sources/golden.json). The palette's own parse wins when it is
// search-ready; otherwise the server's /parse_query answers (services/visualex
// tests/test_nl_parser_convention.py holds it to the same file). So a label either is not
// search-ready here, or writes itself back: an act read as another («l. cost.» as the
// Costituzione, «r.d.l.» as a decreto-legge) never does.

function root(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'conventions', 'sources', 'golden.json'))) return dir;
    if (dirname(dir) === dir) throw new Error('conventions/sources/golden.json not found above ' + from);
  }
}

interface Expected { value: string | null; status: string }
interface NormCase { id: string; labels: Record<string, Expected> }

const golden = JSON.parse(readFileSync(join(root(__dirname), 'conventions', 'sources', 'golden.json'), 'utf8')) as { norms: NormCase[] };

const WRITERS: Array<[string, (norm: LabelledNorm) => string]> = [['citation', citeNorm], ['short', shortNorm]];

function asNorm(parsed: ParsedCitation): LabelledNorm {
  return {
    tipo_atto: parsed.act_type,
    numero_atto: parsed.act_number,
    data: parsed.date,
    numero_articolo: parsed.article,
    allegato: parsed.annex,
  };
}

describe('a convention label typed into the palette names its own norm', () => {
  for (const [kind, write] of WRITERS) {
    const cases = golden.norms.filter((c) => c.labels[kind]?.value);
    it(`has ${kind} cases`, () => expect(cases.length).toBeGreaterThan(15));
    for (const c of cases) {
      const label = c.labels[kind].value as string;
      it(`${c.id}: «${label}»`, () => {
        const parsed = parseLegalCitation(label);
        if (!isSearchReady(parsed)) return; // the server answers it
        expect(write(asNorm(parsed!))).toBe(label);
      });
    }
  }
});

// The palette leaves the d.m. and the d.p.c.m. to the server (a d.p.c.m. has no number, so
// the palette could not tell when one is complete); every other type it reads itself.
const LEFT_TO_THE_SERVER = new Set(['decreto ministeriale', 'decreto del presidente del consiglio dei ministri']);

describe('every type the convention abbreviates reads back with its day and number', () => {
  for (const type of Object.keys(ACT_TYPES)) {
    for (const data of ['1993-09-01', '2012-04-20']) {
      const norm: LabelledNorm = { tipo_atto: type, numero_atto: '7', data, numero_articolo: '3' };
      const label = citeNorm(norm);
      it(`«${label}»`, () => {
        const parsed = parseLegalCitation(label);
        expect(isSearchReady(parsed)).toBe(!LEFT_TO_THE_SERVER.has(type));
        if (LEFT_TO_THE_SERVER.has(type)) return;
        expect([parsed!.act_number, parsed!.date, parsed!.article]).toEqual(['7', data, '3']);
        expect(citeNorm(asNorm(parsed!))).toBe(label);
      });
    }
  }
});

describe('a legge costituzionale is never the Costituzione', () => {
  it.each([
    'art. 1, l. cost. 20 aprile 2012, n. 1',
    'art. 1 l. cost. 1/2012',
    'art. 1 legge cost. 1/2012',
    'art. 1 l. costituzionale 1/2012',
    'art. 1 legge costituzionale 1/2012',
  ])('«%s»', (label) => {
    expect(parseLegalCitation(label)).toMatchObject({ act_type: 'legge costituzionale', act_number: '1', article: '1' });
  });

  it.each(['art. 3 cost. n. 1', 'art. 3 Cost. 2012', 'art. 3 costituzione 20 aprile 2012'])(
    'a Costituzione with a number or a date is refused: «%s»',
    (label) => {
      const parsed = parseLegalCitation(label);
      expect(parsed === null || parsed.act_type !== 'costituzione').toBe(true);
    },
  );

  it.each([
    'art. 81 Cost.', 'art 3 cost', 'art. 3 costituzione',
    // A paragraph after the act is not its number.
    'art. 24 Cost., comma 2', 'art. 3 Cost. co. 1', 'art. 3 Cost. comma 1', 'art. 3 Cost. 1° comma', 'art 32 cost 2 comma',
  ])('the Costituzione itself still reads: «%s»', (label) => {
    const parsed = parseLegalCitation(label);
    expect(parsed?.act_type).toBe('costituzione');
    expect(isSearchReady(parsed)).toBe(true);
  });
});

describe('the annex', () => {
  it.each([
    ['art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A)', 'A'],
    ['art. 1 d.lgs. 81/2008 (All. A)', 'A'],
    ['art. 1 d.lgs. 81/2008 allegato a', 'A'],
    ['art. 2 d.lgs. 81/2008 (Allegato 3)', '3'],
    ['art. 2 d.lgs. 81/2008 allegato XL', 'XL'],
  ])('«%s» → %s, sent with the search', (label, annex) => {
    const parsed = parseLegalCitation(label);
    expect(parsed).toMatchObject({ act_type: 'decreto legislativo', act_number: '81', annex });
    expect(toSearchParams(parsed!).annex).toBe(annex);
    expect(formatParsedCitation(parsed!)).toContain(`(All. ${annex})`);
  });

  it.each(['art. 1 d.lgs. 81/2008 allegato al decreto', 'art. 5 del regolamento allegato a d.lgs. 81/2008'])(
    'a word after «allegato» is no annex: «%s»',
    (label) => {
      const parsed = parseLegalCitation(label);
      expect(parsed?.act_number).toBe('81');
      expect(parsed?.annex).toBeUndefined();
      expect('annex' in toSearchParams(parsed!)).toBe(false);
    },
  );
});

describe('the first of the month', () => {
  it.each(['art. 127, d.lgs. 1° settembre 1993, n. 385', 'art. 127, d.lgs. 1º settembre 1993, n. 385', 'art. 127, d.lgs. 1°settembre 1993, n. 385'])('«%s»', (label) => {
    expect(parseLegalCitation(label)).toMatchObject({ date: '1993-09-01', act_number: '385' });
  });
});
