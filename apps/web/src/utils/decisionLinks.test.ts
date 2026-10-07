import { describe, expect, it } from 'vitest';
import {
  brocardiDecisionRef,
  decisionKey,
  decisionPath,
  describeNotice,
  formatDecisionCitation,
  formatDecisionDeposit,
  formatDecisionHeading,
  formatDecisionShort,
  httpsUrl,
  linkableDecisionPath,
  notFoundMessage,
  parseDecisionPath,
} from './decisionLinks';
import type { DecisionNotice, NotFoundDecision } from '../types/decisions';

const NOW = new Date('2026-10-01T12:00:00Z');
const none = new URLSearchParams();

describe('decision addresses', () => {
  it('builds the readable paths of spec §2', () => {
    expect(decisionPath({ corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }))
      .toBe('/sentenze/cassazione-civile/10787/2024');
    expect(decisionPath({ corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }))
      .toBe('/sentenze/cassazione-penale/10787/2024');
    expect(decisionPath({ corte: 'cassazione', numero: 10787, anno: 2024, sezione: '3' }))
      .toBe('/sentenze/cassazione/10787/2024?sezione=3');
    expect(decisionPath({ corte: 'corte_costituzionale', numero: 1, anno: 2014, sezione: 'III' }))
      .toBe('/sentenze/corte-costituzionale/1/2014');
  });

  it('reads them back, leading zeros dropped, the section kept as written', () => {
    expect(parseDecisionPath({ corte: 'cassazione', numero: '010787', anno: '2024' },
      new URLSearchParams('sezione=III'), NOW)).toEqual({
      ok: true, reference: { corte: 'cassazione', numero: 10787, anno: 2024, sezione: 'III' } });
    expect(parseDecisionPath({ corte: 'cassazione-penale', numero: '1399', anno: '2000' }, none, NOW))
      .toEqual({ ok: true, reference: { corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 2000 } });
  });

  it('reads the civil slug, and drops the section for the Corte costituzionale', () => {
    expect(parseDecisionPath({ corte: 'cassazione-civile', numero: '10787', anno: '2024' }, none, NOW))
      .toEqual({ ok: true, reference: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 } });
    expect(parseDecisionPath({ corte: 'corte-costituzionale', numero: '1', anno: '2014' },
      new URLSearchParams('sezione=III'), NOW))
      .toStrictEqual({ ok: true, reference: { corte: 'corte_costituzionale', numero: 1, anno: 2014 } });
  });

  it('a section of spaces is no section', () => {
    expect(parseDecisionPath({ corte: 'cassazione', numero: '5', anno: '2024' },
      new URLSearchParams('sezione=%20%20'), NOW))
      .toStrictEqual({ ok: true, reference: { corte: 'cassazione', numero: 5, anno: 2024 } });
  });

  it('the year goes up to the current one and not beyond', () => {
    const year = NOW.getFullYear();
    expect(parseDecisionPath({ corte: 'cassazione', numero: '5', anno: String(year) }, none, NOW).ok).toBe(true);
    const next = parseDecisionPath({ corte: 'cassazione', numero: '5', anno: String(year + 1) }, none, NOW);
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(Object.keys(next.errors)).toEqual(['anno']);
  });

  it('no property of Object.prototype is a court', () => {
    for (const corte of ['constructor', 'toString', '__proto__']) {
      const parsed = parseDecisionPath({ corte, numero: '12', anno: '2020' }, none, NOW);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.errors).toHaveProperty('corte');
      expect(parsed.partial).toEqual({ numero: 12, anno: 2020 });
    }
  });

  it('names what is wrong and keeps what could be read', () => {
    const parsed = parseDecisionPath({ corte: 'tar', numero: '12', anno: '2031' }, none, NOW);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.errors).sort()).toEqual(['anno', 'corte']);
    expect(parsed.partial).toEqual({ numero: 12 });
    const old = parseDecisionPath({ corte: 'corte-costituzionale', numero: '1', anno: '1950' }, none, NOW);
    expect(old.ok).toBe(false);
    expect(parseDecisionPath({ corte: 'cassazione', numero: '0', anno: '2024' }, none, NOW).ok).toBe(false);
    expect(parseDecisionPath({ corte: 'cassazione', numero: '1234567', anno: '2024' }, none, NOW).ok).toBe(false);
    expect(parseDecisionPath({ corte: 'cassazione', numero: '12345678', anno: '2024' }, none, NOW).ok).toBe(false);
  });

  it('keys are the shared contract', () => {
    expect(decisionKey({ corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }))
      .toBe('cassazione:penale:10787:2024');
    expect(decisionKey({ corte: 'corte_costituzionale', numero: 1, anno: 2014 }))
      .toBe('corte_costituzionale:1:2014');
  });
});

describe('links from data that names a decision loosely (shared with the rassegne round)', () => {
  it('with the archive, the identity path and no section', () => {
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: 'civile', numero: 13319, anno: 2024, sezione: 'U' }, NOW))
      .toBe('/sentenze/cassazione-civile/13319/2024');
    expect(linkableDecisionPath({ corte: 'corte_costituzionale', numero: 1, anno: 2014 }, NOW))
      .toBe('/sentenze/corte-costituzionale/1/2014');
  });

  it('without the archive, the section as written, encoded', () => {
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: null, numero: 10787, anno: 2024, sezione: '6-3 ' }, NOW))
      .toBe('/sentenze/cassazione/10787/2024?sezione=6-3');
    expect(linkableDecisionPath({ corte: 'cassazione', numero: 10787, anno: 2024, sezione: 'sez. un.' }, NOW))
      .toBe('/sentenze/cassazione/10787/2024?sezione=sez.%20un.');
  });

  it('null when the data cannot make a link', () => {
    for (const raw of [
      { corte: 'tar', numero: 1, anno: 2024 },
      { corte: 'cassazione', archivio: 'civile', numero: 1, anno: null },
      { corte: 'cassazione', numero: 0, anno: 2024 },
      { corte: 'cassazione', numero: 1_000_000, anno: 2024 },
      { corte: 'corte_costituzionale', numero: 1, anno: 1950 },
    ]) {
      expect(linkableDecisionPath(raw, NOW)).toBeNull();
    }
  });

  it('null for a court named like a property of Object.prototype', () => {
    for (const corte of ['constructor', 'toString', '__proto__']) {
      expect(linkableDecisionPath({ corte, numero: 1, anno: 2024 }, NOW)).toBeNull();
    }
  });
});

describe('a link and the page it opens agree', () => {
  it('every path linkableDecisionPath builds parses back to the same court, number and year', () => {
    const year = NOW.getFullYear();
    const loose = [
      { corte: 'cassazione', archivio: 'civile', numero: 13319, anno: 2024, sezione: 'U' },
      { corte: 'cassazione', archivio: 'penale', numero: 1, anno: 1900 },
      { corte: 'cassazione', archivio: null, numero: 999_999, anno: year, sezione: 'sez. un.' },
      { corte: 'cassazione', numero: 10787, anno: 2024 },
      { corte: 'corte_costituzionale', numero: 1, anno: 1956 },
      { corte: 'corte_costituzionale', numero: 999_999, anno: year },
    ];
    for (const raw of loose) {
      const path = linkableDecisionPath(raw, NOW);
      expect(path).not.toBeNull();
      if (path === null) return;
      const url = new URL(path, 'https://visualex.test');
      const [, , slug, numero, anno] = url.pathname.split('/');
      const parsed = parseDecisionPath({ corte: slug, numero, anno }, url.searchParams, NOW);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.reference).toMatchObject({ corte: raw.corte, numero: raw.numero, anno: raw.anno });
    }
  });
});

describe('how a decision is named', () => {
  const civ = { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 } as const;
  const pen = { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 } as const;
  const cost = { corte: 'corte_costituzionale', numero: 1, anno: 2014 } as const;

  it('heading', () => {
    expect(formatDecisionHeading(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22' }))
      .toBe('Corte di cassazione · Sez. III civile · Ordinanza n. 10787/2024 · depositata il 22 aprile 2024');
    expect(formatDecisionHeading(pen, { sezione: 'U', tipo: 'sentenza' }))
      .toBe('Corte di cassazione · Sezioni Unite penali · Sentenza n. 10787/2024');
    expect(formatDecisionHeading(cost, { tipo: 'sentenza', data_decisione: '2013-12-04',
      data_deposito: '2014-01-13', ecli: 'ECLI:IT:COST:2014:1' }))
      .toBe('Corte costituzionale · Sentenza n. 1/2014 · decisa il 4 dicembre 2013 · depositata il 13 gennaio 2014 · ECLI:IT:COST:2014:1');
  });

  it('the heading agrees «depositato» with a decreto', () => {
    expect(formatDecisionHeading(civ, { sezione: '3', tipo: 'decreto', data_deposito: '2024-04-22' }))
      .toBe('Corte di cassazione · Sez. III civile · Decreto n. 10787/2024 · depositato il 22 aprile 2024');
  });

  it('the heading writes "il" as "l\'" before 8 and 11, and keeps the plain date for the 1st', () => {
    expect(formatDecisionHeading(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-01' }))
      .toBe('Corte di cassazione · Sez. III civile · Ordinanza n. 10787/2024 · depositata il 1 aprile 2024');
    expect(formatDecisionHeading(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-08' }))
      .toBe("Corte di cassazione · Sez. III civile · Ordinanza n. 10787/2024 · depositata l'8 aprile 2024");
    expect(formatDecisionHeading(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-11' }))
      .toBe("Corte di cassazione · Sez. III civile · Ordinanza n. 10787/2024 · depositata l'11 aprile 2024");
    expect(formatDecisionHeading(cost, { tipo: 'sentenza', data_decisione: '2013-11-08', data_deposito: '2014-01-11' }))
      .toBe("Corte costituzionale · Sentenza n. 1/2014 · decisa l'8 novembre 2013 · depositata l'11 gennaio 2014");
  });

  it('citation, as lawyers write it', () => {
    expect(formatDecisionCitation(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22' }))
      .toBe('Cass. civ., sez. III, ord. 22 aprile 2024, n. 10787');
    expect(formatDecisionCitation(pen, { sezione: '7', tipo: 'sentenza', data_deposito: '2024-03-12' }))
      .toBe('Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787');
    expect(formatDecisionCitation(civ, { sezione: 'U' })).toBe('Cass. civ., sez. un., n. 10787/2024');
    expect(formatDecisionCitation(cost, { tipo: 'sentenza', data_deposito: '2014-01-13' }))
      .toBe('Corte cost., sent. 13 gennaio 2014, n. 1');
  });

  it('a citation writes the first of a month as 1°, and no other day differently', () => {
    expect(formatDecisionCitation(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-01' }))
      .toBe('Cass. civ., sez. III, ord. 1° aprile 2024, n. 10787');
    expect(formatDecisionCitation(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-08' }))
      .toBe('Cass. civ., sez. III, ord. 8 aprile 2024, n. 10787');
  });

  it('notices, with and without the section as cited', () => {
    expect(describeNotice({ tipo: 'sezione_diversa', citata: 'I', effettiva: '3' }))
      .toBe('La citazione indica la sezione I; la decisione è della Sez. III.');
    expect(describeNotice({ tipo: 'sezione_diversa', effettiva: '3' }))
      .toBe("La citazione indica un'altra sezione; la decisione è della Sez. III.");
    expect(describeNotice({ tipo: 'sezione_non_riconosciuta', citata: '6-3' }))
      .toBe('La sezione indicata («6-3») non è riconoscibile ed è stata ignorata.');
    expect(describeNotice({ tipo: 'sezione_non_riconosciuta' }))
      .toBe('La sezione indicata non è riconoscibile ed è stata ignorata.');
    expect(describeNotice({ tipo: 'archivio_dedotto', archivio: 'penale', sezione: '7' }))
      .toBe('Con questi estremi esistono una decisione civile e una penale: la Sez. VII indicata è quella penale.');
  });

  it('the Sezioni Unite agree: plural where every other section is singular', () => {
    expect(describeNotice({ tipo: 'sezione_diversa', citata: 'I', effettiva: 'U' }))
      .toBe('La citazione indica la sezione I; la decisione è delle Sezioni Unite.');
    expect(describeNotice({ tipo: 'sezione_diversa', effettiva: 'U' }))
      .toBe("La citazione indica un'altra sezione; la decisione è delle Sezioni Unite.");
    expect(describeNotice({ tipo: 'sezione_diversa', effettiva: 'L' }))
      .toBe("La citazione indica un'altra sezione; la decisione è della Sez. Lavoro.");
    expect(describeNotice({ tipo: 'archivio_dedotto', archivio: 'penale', sezione: 'U' }))
      .toBe('Con questi estremi esistono una decisione civile e una penale: le Sezioni Unite indicate sono quelle penali.');
    expect(describeNotice({ tipo: 'archivio_dedotto', archivio: 'civile', sezione: 'U' }))
      .toBe('Con questi estremi esistono una decisione civile e una penale: le Sezioni Unite indicate sono quelle civili.');
  });

  it('a missing text, and why only when the source said so', () => {
    expect(describeNotice({ tipo: 'testo_non_disponibile' }, { sezione: '3', testo_assente: 'oscuramento' }))
      .toBe('Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di oscuramento dei dati personali.');
    expect(describeNotice({ tipo: 'testo_non_disponibile' }, { testo_assente: 'valutazione_oscuramento' }))
      .toBe("Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di valutazione per l'oscuramento dei dati personali.");
    expect(describeNotice({ tipo: 'testo_non_disponibile' }, { sezione: '3' })).toBe('Testo non disponibile presso la fonte.');
    expect(describeNotice({ tipo: 'testo_non_disponibile' })).toBe('Testo non disponibile presso la fonte.');
  });

  it('a text read from the archive, not the court\'s PDF, is declared provisional', () => {
    expect(describeNotice({ tipo: 'testo_da_archivio' }))
      .toBe("Testo dell'archivio della Cassazione, provvisorio: potrebbe essere incompleto, e le note potrebbero non ritrovarsi nel testo completo.");
  });

  it('not-found messages say what an archive holds, never that a decision does not exist', () => {
    const ref = { corte: 'cassazione', numero: 1, anno: 2019 } as const;
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'fuori_archivio', archivio_dal: '2021-02-17' }, ref))
      .toBe("L'archivio pubblico della Cassazione parte dal 17 febbraio 2021: questa decisione è precedente e qui non si può consultare.");
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'fuori_archivio' }, ref))
      .toBe("La decisione è anteriore all'archivio pubblico della Cassazione (circa gli ultimi cinque anni) e qui non si può consultare.");
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'anno_parziale', archivio_dal: '2021-02-17' }, { ...ref, anno: 2021 }))
      .toBe("L'archivio pubblico della Cassazione copre il 2021 solo dal 17 febbraio 2021: non si può escludere che la decisione esista.");
    // the archive's start could not be read
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'anno_parziale' }, { ...ref, anno: 2021 }))
      .toBe("L'archivio pubblico della Cassazione copre il 2021 solo in parte: non si può escludere che la decisione esista.");
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'inesistente' }, { ...ref, archivio: 'penale', anno: 2024 }))
      .toBe("La decisione n. 1/2024 non è presente nell'archivio pubblico penale della Cassazione.");
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'inesistente' }, { ...ref, anno: 2024 }))
      .toBe("La decisione n. 1/2024 non è presente nell'archivio pubblico della Cassazione, né civile né penale.");
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'inesistente' }, { corte: 'corte_costituzionale', numero: 999, anno: 2014 }))
      .toBe('La decisione n. 999/2014 non è presente nei dati aperti della Corte costituzionale, aggiornati ogni giorno: se è stata depositata negli ultimi giorni, riprova domani.');
  });

  it('the archive start, after "dal", is written "dall\'" before 8 and 11', () => {
    const ref = { corte: 'cassazione', numero: 1, anno: 2024 } as const;
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'fuori_archivio', archivio_dal: '2024-04-11' }, ref))
      .toBe("L'archivio pubblico della Cassazione parte dall'11 aprile 2024: questa decisione è precedente e qui non si può consultare.");
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'anno_parziale', archivio_dal: '2024-04-08' }, ref))
      .toBe("L'archivio pubblico della Cassazione copre il 2024 solo dall'8 aprile 2024: non si può escludere che la decisione esista.");
  });

  it('a notice or a reason the page does not know gets a plain sentence, never undefined and never a claim', () => {
    expect(describeNotice({ tipo: 'avviso_nuovo' } as unknown as DecisionNotice)).toBe('Avviso della fonte.');
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'motivo_nuovo' } as unknown as NotFoundDecision,
      { corte: 'cassazione', numero: 1, anno: 2024 })).toBe('La decisione n. 1/2024 non è stata trovata.');
  });
});

// The source link of a decision comes from our server, built on fixed bases: this is defence in
// depth, for the day that stops being so.
describe('httpsUrl', () => {
  it('keeps an https address', () => {
    expect(httpsUrl('https://www.cortecostituzionale.it/scheda-pronuncia/2014/1'))
      .toBe('https://www.cortecostituzionale.it/scheda-pronuncia/2014/1');
  });

  it.each([
    ['http', 'http://www.cortecostituzionale.it/scheda-pronuncia/2014/1'],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: in capitals', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['ftp', 'ftp://www.cortecostituzionale.it/scheda-pronuncia/2014/1'],
    ['a protocol-relative address', '//evil.example'],
    ['a relative path', '/scheda-pronuncia/2014/1'],
    ['a string that is no address', 'non un indirizzo'],
    ['an empty string', ''],
    ['nothing', undefined],
  ])('gives null for %s', (_what, value) => {
    expect(httpsUrl(value)).toBeNull();
  });

  it('gives the address as it parses, so the page links what was checked', () => {
    // "https:host" is read relative to the page's own address by a browser, and as a host by `new URL`
    expect(httpsUrl('https:www.cortecostituzionale.it/scheda-pronuncia/2014/1'))
      .toBe('https://www.cortecostituzionale.it/scheda-pronuncia/2014/1');
    expect(httpsUrl('HTTPS://www.cortecostituzionale.it/scheda-pronuncia/2014/1'))
      .toBe('https://www.cortecostituzionale.it/scheda-pronuncia/2014/1');
  });
});

// The golden file pins the decided short labels (utils/__tests__/sourcesGolden.test.ts); these are the
// section codes the Massimario writes and the file does not list, as MERL-T's `decision_short` writes them.
describe('formatDecisionShort', () => {
  it('writes every section code as the courts print it', () => {
    const at = (sezione: string) => formatDecisionShort({ corte: 'cassazione', archivio: 'civile', numero: 5, anno: 2020, sezione });
    expect(at('T')).toBe('Cass. civ., sez. trib., n. 5/2020');
    expect(at('6-1')).toBe('Cass. civ., sez. VI-1, n. 5/2020');
    expect(at(' u. ')).toBe('Cass. civ., sez. un., n. 5/2020');
    expect(at('F')).toBe('Cass. civ., sez. fer., n. 5/2020');
  });

  it('joins several massime', () => {
    expect(formatDecisionShort({ corte: 'cassazione', archivio: 'penale', numero: 9, anno: 2021 }, ['1-01', '1-02']))
      .toBe('Cass. pen., n. 9/2021 · Rv. 1-01, 1-02');
    expect(formatDecisionShort({ corte: 'corte_costituzionale', numero: 71, anno: 2020 }, [])).toBe('Corte cost., n. 71/2020');
  });
});

describe('brocardiDecisionRef', () => {
  it('reads the courts Brocardi heads a massima with', () => {
    expect(brocardiDecisionRef('Cass. civ.', '31191', '2025')).toEqual({ corte: 'cassazione', archivio: 'civile', numero: 31191, anno: 2025 });
    expect(brocardiDecisionRef('Cass. pen', '12', '2023')).toEqual({ corte: 'cassazione', archivio: 'penale', numero: 12, anno: 2023 });
    expect(brocardiDecisionRef('Cass. lav.', '7', '2019')).toEqual({ corte: 'cassazione', archivio: 'civile', sezione: 'L', numero: 7, anno: 2019 });
    expect(brocardiDecisionRef('Cass. sez. un.', '8', '2018')).toEqual({ corte: 'cassazione', sezione: 'U', numero: 8, anno: 2018 });
    expect(brocardiDecisionRef('Corte cost.', '71', '2020')).toEqual({ corte: 'corte_costituzionale', numero: 71, anno: 2020 });
    expect(brocardiDecisionRef('Corte Costituzionale', '71', '2020')?.corte).toBe('corte_costituzionale');
  });

  it('reads «Cassazione» spelled out as a bare Cass., naming no archive', () => {
    expect(brocardiDecisionRef('Cassazione', '2633', '1982')).toEqual({ corte: 'cassazione', numero: 2633, anno: 1982 });
  });

  it('names no archive for a bare «Cass.», and is linked as a reference', () => {
    const ref = brocardiDecisionRef('Cass', '2633', '1982');
    expect(ref).toEqual({ corte: 'cassazione', numero: 2633, anno: 1982 });
    expect(formatDecisionShort(ref!)).toBe('Cass., n. 2633/1982');
    expect(linkableDecisionPath(ref!, new Date('2026-10-06'))).toBe('/sentenze/cassazione/2633/1982');
  });

  it('is null for another court or no number', () => {
    for (const autorita of ['Cons. Stato', 'TAR Lazio', 'Trib.', 'CGUE', null]) {
      expect(brocardiDecisionRef(autorita, '10', '2020')).toBeNull();
    }
    expect(brocardiDecisionRef('Cass. civ.', null, '2020')).toBeNull();
    expect(brocardiDecisionRef('Cass. civ.', 'x', '2020')).toBeNull();
  });
});

describe('formatDecisionDeposit', () => {
  it.each([
    ['sentenza', 'Sentenza depositata il 1 settembre 2026'],
    ['ordinanza', 'Ordinanza depositata il 1 settembre 2026'],
    ['ordinanza interlocutoria', 'Ordinanza interlocutoria depositata il 1 settembre 2026'],
    ['decreto', 'Decreto depositato il 1 settembre 2026'],
  ])('%s agrees in gender', (tipo, expected) => {
    expect(formatDecisionDeposit({ tipo, data_deposito: '2026-09-01' })).toBe(expected);
  });
  it('says only what is known', () => {
    expect(formatDecisionDeposit({ tipo: 'sentenza' })).toBe('Sentenza');
    expect(formatDecisionDeposit({ data_deposito: '2026-09-08' })).toBe("Depositata l'8 settembre 2026");
    expect(formatDecisionDeposit({})).toBeNull();
  });
});
