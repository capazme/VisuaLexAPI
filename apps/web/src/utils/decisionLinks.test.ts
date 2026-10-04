import { describe, expect, it } from 'vitest';
import {
  decisionKey,
  decisionPath,
  describeNotice,
  formatDecisionCitation,
  formatDecisionHeading,
  linkableDecisionPath,
  notFoundMessage,
  parseDecisionPath,
} from './decisionLinks';

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

  it('citation, as lawyers write it', () => {
    expect(formatDecisionCitation(civ, { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22' }))
      .toBe('Cass. civ., sez. III, ord. 22 aprile 2024, n. 10787');
    expect(formatDecisionCitation(pen, { sezione: '7', tipo: 'sentenza', data_deposito: '2024-03-12' }))
      .toBe('Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787');
    expect(formatDecisionCitation(civ, { sezione: 'U' })).toBe('Cass. civ., sez. un., n. 10787/2024');
    expect(formatDecisionCitation(cost, { tipo: 'sentenza', data_deposito: '2014-01-13' }))
      .toBe('Corte cost., sent. 13 gennaio 2014, n. 1');
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

  it('a missing text, and why only when the source said so', () => {
    expect(describeNotice({ tipo: 'testo_non_disponibile' }, { sezione: '3', testo_assente: 'oscuramento' }))
      .toBe('Testo non disponibile presso la fonte: la Corte di cassazione lo indica come in fase di oscuramento dei dati personali.');
    expect(describeNotice({ tipo: 'testo_non_disponibile' }, { sezione: '3' })).toBe('Testo non disponibile presso la fonte.');
    expect(describeNotice({ tipo: 'testo_non_disponibile' })).toBe('Testo non disponibile presso la fonte.');
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
});
