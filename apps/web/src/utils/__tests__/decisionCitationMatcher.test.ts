import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractDecisionCitations, type DecisionContext } from '../decisionCitationMatcher';
import { parseDecisionPath } from '../decisionLinks';

// The sentences and the spans they hold live in the convention's golden file
// (decision_citations_in_text); the words are read by the same parser as decision_citations.
function findGolden(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'conventions', 'sources', 'golden.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('conventions/sources/golden.json not found above ' + from);
  }
}

interface GoldenSpan { start: number; end: number; text: string; reference: unknown; path: string }
interface GoldenCase { text: string; within?: DecisionContext; spans: GoldenSpan[]; status: string }
const { today, cases } = (JSON.parse(readFileSync(findGolden(__dirname), 'utf8')) as {
  decision_citations_in_text: { today: string; cases: GoldenCase[] };
}).decision_citations_in_text;
const NOW = new Date(`${today}T12:00:00Z`);

const spansOf = (text: string, within?: DecisionContext) => extractDecisionCitations(text, { within, now: NOW });
const writtenIn = (text: string, within?: DecisionContext) => spansOf(text, within).map((s) => text.slice(s.start, s.end));

describe('extractDecisionCitations, the golden file', () => {
  it('has the cases', () => {
    expect(cases.length).toBeGreaterThan(40);
    expect(cases.filter((c) => c.spans.length > 0).length).toBeGreaterThan(30);
    expect(cases.filter((c) => c.spans.length === 0).length).toBeGreaterThan(10);
  });

  for (const c of cases) {
    it(`${c.within ? `[${c.within}] ` : ''}${c.text.replace(/\n/g, '⏎')}`, () => {
      for (const s of c.spans) expect(c.text.slice(s.start, s.end)).toBe(s.text); // the file spells its own offsets right
      expect(spansOf(c.text, c.within)).toEqual(c.spans.map(({ start, end, reference, path }) => ({ start, end, reference, path })));
    });
  }

  it('gives an address the app reads back', () => {
    for (const c of cases) {
      for (const s of c.spans) {
        const [pathname, query] = s.path.split('?');
        const [, , corte, numero, anno] = pathname.split('/');
        const read = parseDecisionPath({ corte, numero, anno }, new URLSearchParams(query), NOW);
        expect(read.ok, s.path).toBe(true);
        expect(read.ok && read.reference, s.path).toMatchObject({
          corte: (s.reference as { corte: string }).corte,
          numero: (s.reference as { numero: number }).numero,
          anno: (s.reference as { anno: number }).anno,
        });
      }
    }
  });
});

describe('extractDecisionCitations, in a sentence', () => {
  it('finds nothing in an empty text or one without a court', () => {
    expect(spansOf('')).toEqual([]);
    expect(spansOf('Il giudice ha deciso il 12/05/2020 con il n. 5/2020.')).toEqual([]);
  });

  it('ends a citation at its number, without the prose after it', () => {
    expect(writtenIn('Cass. civ. n. 5 del 2020 ha affermato che la domanda è fondata')).toEqual(['Cass. civ. n. 5 del 2020']);
    expect(writtenIn('Corte cost. n. 71/2020 in tema di tutela')).toEqual(['Corte cost. n. 71/2020']);
  });

  it('does not take a date in the next sentence for the citation’s year', () => {
    expect(spansOf('Cass. n. 5 è stata citata. Il 3 marzo 2021 il giudice ha deciso.')).toEqual([]);
    expect(spansOf('Cass. n. 5 è richiamata e, molte parole dopo, il 3 marzo 2021 il giudice decide.')).toEqual([]);
  });

  it('keeps a full stop after an abbreviation inside the citation', () => {
    expect(writtenIn('Cass. civ., sez. un., sent. n. 31310/2024. Il principio vale.')).toEqual(['Cass. civ., sez. un., sent. n. 31310/2024']);
    expect(writtenIn('T.A.R. Lazio, Roma, sez. I, n. 1234/2020.')).toEqual(['T.A.R. Lazio, Roma, sez. I, n. 1234/2020']);
  });

  it('closes the parenthesis it opened, and only that one', () => {
    const text = 'Cass. pen., sez. II, n. 1399/1999 (dep. 2000) e (Cass. n. 5/2020).';
    expect(writtenIn(text)).toEqual(['Cass. pen., sez. II, n. 1399/1999 (dep. 2000)', 'Cass. n. 5/2020']);
  });

  it('reads two citations of one sentence apart', () => {
    const found = spansOf('Cass. n. 1/2020 e Cons. Stato n. 2/2021.');
    expect(found.map((s) => s.reference.corte)).toEqual(['cassazione', 'consiglio_di_stato']);
    expect(found[0].end).toBeLessThanOrEqual(found[1].start);
  });

  it('reads a citation across a line break', () => {
    const text = 'Cass.\nciv.,\nsez. III,\n12 aprile 2022,\nn. 12789';
    expect(writtenIn(text)).toEqual([text]);
  });

  it('breaks at a blank line', () => {
    expect(spansOf('Cass. civ.\n\nn. 5/2020')).toEqual([]);
  });

  it('keeps the offsets of the text it was given, accents and non-breaking spaces included', () => {
    const text = 'Così è già stato deciso: Cass. civ., sez. III, n. 12789/2022 — fine.';
    const [found] = spansOf(text);
    expect(text.slice(found.start, found.end)).toBe('Cass. civ., sez. III, n. 12789/2022');
    expect(found.reference).toMatchObject({ corte: 'cassazione', numero: 12789, anno: 2022, archivio: 'civile', sezione: 'III' });
  });

  it('writes the court as the text does, in capitals or not', () => {
    expect(writtenIn('CASS. CIV., SEZ. III, N. 12789/2022')).toEqual(['CASS. CIV., SEZ. III, N. 12789/2022']);
    expect(writtenIn('cass. n. 5/2020')).toEqual(['cass. n. 5/2020']);
  });

  it('reads the year against the clock it is given', () => {
    expect(extractDecisionCitations('Cass. n. 5/2020', { now: new Date('2020-06-01T12:00:00Z') })).toHaveLength(1);
    expect(extractDecisionCitations('Cass. n. 5/2020', { now: new Date('2019-01-01T12:00:00Z') })).toEqual([]);
  });
});

describe('extractDecisionCitations, the court is read and not guessed (D2)', () => {
  it('links no bare number, in any context', () => {
    for (const within of [undefined, 'cassazione' as const]) {
      expect(spansOf('Si veda n. 123/2020, sent. 8980/2018 e la sentenza n. 5 del 2021.', within)).toEqual([]);
    }
  });

  it('reads a section as the Cassazione only inside a Cassazione decision', () => {
    expect(spansOf('Sez. U, n. 9100 del 2015')).toEqual([]);
    expect(spansOf('Sez. 3, n. 5/2020')).toEqual([]);
    expect(spansOf('S.U. n. 31310/2024')).toEqual([]);
    expect(writtenIn('Sez. U, n. 9100 del 2015', 'cassazione')).toEqual(['Sez. U, n. 9100 del 2015']);
  });

  it('does not take the preposition «su» for the Sezioni Unite', () => {
    expect(spansOf('si fonda su 12/2020 e su n. 5/2020', 'cassazione')).toEqual([]);
    expect(spansOf('SU n. 5 del 2020', 'cassazione')).toHaveLength(1);
  });

  it('does not read a section standing in prose as a citation', () => {
    expect(spansOf('la sezione III del codice prevede, nel 2020, il n. 5', 'cassazione')).toEqual([]);
    expect(spansOf('Sez. U, ha stabilito molte cose, in sostanza, n. 5/2020', 'cassazione')).toEqual([]);
  });

  it('does not let a court cross prose to reach a number', () => {
    expect(spansOf('La Corte costituzionale ha dichiarato illegittima la legge n. 12/2010.')).toEqual([]);
    expect(spansOf('Cass. ha affermato in sostanza che il n. 5/2020 non conta.')).toEqual([]);
  });

  it('keeps a TAR’s seat, a proper name, inside the citation', () => {
    expect(writtenIn('T.A.R. Friuli-Venezia Giulia, Trieste, sez. I, n. 12/2020')).toEqual(['T.A.R. Friuli-Venezia Giulia, Trieste, sez. I, n. 12/2020']);
  });

  it('does not take a lower-case case number or a letter without a dash for a case of the Union', () => {
    expect(spansOf('il punto c-12/2020, la voce T 12/2020 e la lettera C 5/21')).toEqual([]);
  });
});

describe('extractDecisionCitations, acts are not decisions', () => {
  it('finds nothing in an act’s citation', () => {
    for (const text of [
      'art. 267 TFUE',
      'd.l. 17 marzo 2020, n. 18',
      'la direttiva 2006/123/CE e il regolamento (UE) 2016/679',
      'ai sensi dell’art. 3 della legge 7 agosto 1990, n. 241',
    ]) expect(spansOf(text, 'cassazione')).toEqual([]);
  });

  it('keeps a decision beside an act', () => {
    expect(writtenIn('Cass. n. 5/2020 applica la legge 7 agosto 1990, n. 241 e il d.l. n. 18/2020')).toEqual(['Cass. n. 5/2020']);
    expect(writtenIn('Il d.l. n. 18/2020 è stato esaminato da Corte cost. n. 71/2020', 'cassazione')).toEqual(['Corte cost. n. 71/2020']);
  });

  it('does not claim the number of an act a court is written next to', () => {
    expect(spansOf('Cons. Stato, decreto n. 18/2020')).toEqual([]);
    expect(spansOf('Corte cost. decreto-legge n. 18/2020')).toEqual([]);
  });
});

// --- time ---

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTILE_SIZE = 100_000;
const hostile = (unit: string): string => unit.repeat(Math.ceil(HOSTILE_SIZE / unit.length)).slice(0, HOSTILE_SIZE);
const HOSTILE: Array<[string, string]> = [
  ['court heads', hostile('Cass. ')],
  ['court heads with numbers', hostile('Cass. n. 1 ')],
  ['complete citations', hostile('Cass. civ. n. 1/2020 ')],
  ['sections without a court', hostile('Sez. U, n. ')],
  ['complete sections', hostile('Sez. 3, n. 1/2020 ')],
  ['case numbers', hostile('C-1/2 T-3/4 ')],
  ['a court and a long run of spaces', 'Cass.' + ' '.repeat(HOSTILE_SIZE)],
  ['a court and a long run of digits', 'Cass. n. ' + '1'.repeat(HOSTILE_SIZE)],
  ['digits and slashes', hostile('1/2/3/4/5/')],
  ['dots and capitals', hostile('. A. B. ')],
  ['administrative heads', hostile('T.A.R. Lazio, Roma, sez. I, ')],
  ['an act’s name repeated', hostile('decreto ')],
  ['lines', hostile('\n')],
  ['parentheses', hostile('(dep. (dep. ')],
  ['a Union court', hostile('Corte giust. UE, ')],
  ['acts with numbers', hostile('legge n. 1 del 12 marzo regio decreto-legge ')],
  ['one court and many case numbers', 'Cass. ' + hostile('C-1/2 ')],
  ['kinds of decision', hostile('sentenze n. 1 del 2000, ord. n. 2 e ')],
  ['lists of kinds', hostile('sentenza n. 1/2000 e n. 2/2001, n. 3 del 2002 e ')],
  ['numbers sharing a year', hostile('Cass. n. 1 e n. 2, n. 3 e ')],
  ['complete shared-year lists', hostile('sentenze n. 1, n. 2 e n. 3 del 2000 ')],
  ['courts the app cannot open', hostile("Trib. Milano, sez. 3, Corte d'appello ")],
  ['lists of precedents', hostile('Cass. n. 1/2020; Sez. 3, n. 2/2021 (in G.U. ')],
];

describe('extractDecisionCitations, hostile text', () => {
  for (const [name, text] of HOSTILE) {
    it(`reads ${HOSTILE_SIZE.toLocaleString('en')} characters of ${name} in a bounded time`, () => {
      for (const within of ['cassazione', 'corte_costituzionale'] as const) {
        const start = performance.now();
        const found = extractDecisionCitations(text, { within, now: NOW });
        const elapsed = performance.now() - start;
        expect(elapsed, `${name} (${within}): ${elapsed.toFixed(0)} ms`).toBeLessThan(500);
        let last = 0;
        for (const s of found) {
          expect(s.start).toBeGreaterThanOrEqual(last);
          expect(s.end).toBeGreaterThan(s.start);
          last = s.end;
        }
      }
    });
  }

  it('reads 3000 random strings of the citation alphabet in a bounded time, each well formed', () => {
    const alphabet = [
      'Cass.', 'Cassazione', 'civ.', 'pen.', 'sez.', 'Sez.', 'U', 'L', 'III', '6-1', 'un.', 'S.U.', 'SU', 'n.', 'n', 'del', 'dep.', '(', ')',
      ',', '.', ';', ':', '/', '-', '\n', '\n\n', ' ', ' ', ' ', ' ', ' ', '1', '12', '2020', '1999', '99999', '07', 'Corte cost.', 'C. cost.',
      'Cons. Stato', 'Ad. plen.', 'C.G.A.R.S.', 'TAR', 'T.A.R.', 'Lazio', 'Roma', 'T.R.G.A.', 'Bolzano', 'CGUE', 'Corte giust.', 'UE', 'Trib. UE',
      'C-', 'T-', 'causa', 'cause riunite', 'art.', '267', 'TFUE', 'd.l.', 'legge', 'decreto', 'direttiva', 'Il', 'la', 'ha', 'dichiarato',
      'gennaio', 'aprile', 'sentenze', 'sentenza', 'sent.', 'ord.', 'ordinanza', 'Tribunale', 'di', 'Milano', 'Corte', 'e', "l'", '’', 'à', 'È',
    ];
    const random = mulberry32(20261013);
    const texts: string[] = [];
    for (let i = 0; i < 3000; i += 1) {
      const length = 1 + Math.floor(random() * 120);
      let text = '';
      for (let j = 0; j < length; j += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      texts.push(text);
    }
    const start = performance.now();
    const results = texts.map((text, i) => extractDecisionCitations(text, { within: ([undefined, 'cassazione', 'corte_costituzionale'] as const)[i % 3], now: NOW }));
    const elapsed = performance.now() - start;
    expect(elapsed, `${elapsed.toFixed(0)} ms`).toBeLessThan(1000);
    results.forEach((found, i) => {
      let last = 0;
      for (const s of found) {
        expect(s.start, texts[i]).toBeGreaterThanOrEqual(last);
        expect(s.end, texts[i]).toBeGreaterThan(s.start);
        expect(s.end, texts[i]).toBeLessThanOrEqual(texts[i].length);
        expect(s.path).toMatch(/^\/sentenze\//);
        last = s.end;
      }
    });
  });
});

// The act words that keep a decision's number out of an administrative act («nota», «provvedimento»,
// «parere»…) must not swallow the administrative court that follows them as a name.
describe('extractDecisionCitations, administrative acts and administrative courts', () => {
  it('links a decision after «nota» or «provvedimento» when a court follows', () => {
    expect(writtenIn('Come nota il T.A.R. Lazio n. 1234/2018.')).toEqual(['T.A.R. Lazio n. 1234/2018']);
    expect(writtenIn('Come nota il C.d.S. n. 1234/2018.')).toEqual(['C.d.S. n. 1234/2018']);
    expect(writtenIn('Il provvedimento impugnato T.A.R. Lazio n. 1234/2018.')).toEqual(['T.A.R. Lazio n. 1234/2018']);
  });

  it("does not link the administrative act of a court («parere del C.d.S.», «nota del T.A.R.»)", () => {
    expect(writtenIn('Il parere del C.d.S. n. 1234/2018.')).toEqual([]);
    expect(writtenIn('Il parere del Consiglio di Stato n. 1234/2018.')).toEqual([]);
    expect(writtenIn('La nota del T.A.R. Lazio n. 1234/2018.')).toEqual([]);
  });
});

describe('extractDecisionCitations, «C.d.S.» as the codice della strada', () => {
  it('does not link the code cited after an article or a preposition', () => {
    for (const text of [
      'Il verbale ex art. 142 c.d.s. n. 5/2018 è nullo.',
      "Si applica l'art. 142 del c.d.s. n. 5/2018.",
      'Il conducente, in violazione del C.d.S. n. 5/2018, è sanzionato.',
      "Vale l'art. 142, comma 8, C.d.S., n. 5/2018 per la velocità.",
      "Vale l'art. 186 cds n. 5/2018 per la guida.",
      'Vale art. 126-bis c.d.s. n. 5/2018.',
      'Valgono artt. 142 e 143 C.d.S. n. 5/2018.',
    ]) {
      expect(writtenIn(text), text).toEqual([]);
      expect(writtenIn(text, 'cassazione'), text).toEqual([]);
    }
  });

  it('still links the Consiglio di Stato written C.d.S.', () => {
    expect(writtenIn('Come in C.d.S., sez. IV, n. 5/2018 e nulla più.')).toEqual(['C.d.S., sez. IV, n. 5/2018']);
    expect(writtenIn('Come affermato (C.d.S. n. 5/2018) in tema di appalti.')).toEqual(['C.d.S. n. 5/2018']);
    expect(writtenIn('Cfr. art. 142 c.d.s. e C.d.S., sez. IV, n. 5/2018.')).toEqual(['C.d.S., sez. IV, n. 5/2018']);
    expect(writtenIn('Si veda art. 5. C.d.S. n. 5/2018 ha deciso.')).toEqual(['C.d.S. n. 5/2018']);
  });
});

describe('extractDecisionCitations, «C.d.S.» followed by a section is the court', () => {
  it('links the Consiglio di Stato after «del», «dal» or an article, and in a Cassazione decision too', () => {
    const forms: [string, string][] = [
      ['Come afferma la sentenza del C.d.S., sez. IV, n. 5/2018.', 'C.d.S., sez. IV, n. 5/2018'],
      ['Come ritenuto dal C.d.S., sez. IV, n. 5/2018.', 'C.d.S., sez. IV, n. 5/2018'],
      ["Vale l'art. 21-nonies, C.d.S., sez. VI, n. 5/2018 per l'annullamento.", 'C.d.S., sez. VI, n. 5/2018'],
      ["Vale l'art. 21-nonies, C.d.S., Ad. plen., n. 5/2018 per l'annullamento.", 'C.d.S., Ad. plen., n. 5/2018'],
    ];
    for (const [text, span] of forms) {
      for (const within of [undefined, 'cassazione', 'corte_costituzionale'] as const) {
        expect(writtenIn(text, within), `${within} ${text}`).toEqual([span]);
        for (const s of spansOf(text, within)) expect(s.reference.corte, text).toBe('consiglio_di_stato');
      }
    }
  });

  it('without a section, «dal/al/nel C.d.S. n. …» stays the code (truly ambiguous)', () => {
    for (const text of ['Come ritenuto dal C.d.S. n. 5/2018 in tema di appalti.', 'Si rinvia al C.d.S. n. 5/2018.', 'Previsto nel C.d.S. n. 5/2018.']) {
      expect(writtenIn(text), text).toEqual([]);
      expect(writtenIn(text, 'cassazione'), text).toEqual([]);
    }
  });
});
