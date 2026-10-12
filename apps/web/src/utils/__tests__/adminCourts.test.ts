import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SEATS, adminCourtFullName, adminCourtName } from '../adminCourts';
import {
  decisionKey,
  decisionPath,
  describeNotice,
  formatDecisionCitation,
  formatDecisionHeading,
  identityFromKey,
  linkableDecisionPath,
  notFoundMessage,
  parseDecisionPath,
} from '../decisionLinks';
import { parseSentenzaContent, sentenzaFromDecision } from '../../components/features/dossier/dossierUtils';
import { parseDecisionCitation } from '../decisionCitationParser';
import { storedReference } from '../practice';

// The administrative courts (design 2026-10-12-administrative-courts): what the golden file does not
// pin — the seats against the convention's table, the page's address read back, the identity line,
// the notices and the dossier entry.
const NOW = new Date('2026-10-12T12:00:00Z');
const CDS = { corte: 'consiglio_di_stato' as const, provvedimento: 'sent', numero: 2270, anno: 2019 };
const TAR = { corte: 'tar' as const, sede: 'roma', provvedimento: 'ocau', numero: 1234, anno: 2020 };

function seatsFile(): { seats: Array<{ slug: string; sede: string; regione: string; principale: boolean; organo: string }> } {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'tar-seats.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/tar-seats.json not found');
  }
}

describe('the TAR seats', () => {
  it('are the convention\'s', () => {
    const rows = Object.fromEntries(seatsFile().seats.map((s) => [s.slug, [s.sede, s.regione, s.principale, s.organo]]));
    expect(SEATS).toEqual(rows);
  });

  it('name the court as lawyers do, the seat only where the region has several', () => {
    expect(adminCourtName('tar', 'latina')).toBe('TAR Lazio, Latina');
    expect(adminCourtName('tar', 'aosta')).toBe("TAR Valle d'Aosta");
    expect(adminCourtName('tar', 'trento')).toBe('T.R.G.A. Trento');
    expect(adminCourtFullName('tar', 'bolzano')).toBe('T.R.G.A., sezione autonoma di Bolzano');
    expect(adminCourtFullName('cgars', null)).toBe('Consiglio di giustizia amministrativa per la Regione siciliana');
  });
});

describe('the administrative courts', () => {
  it('keep the key and the path the design gives them', () => {
    expect(decisionKey(CDS)).toBe('consiglio_di_stato:sent:2270:2019');
    expect(decisionKey(TAR)).toBe('tar:roma:ocau:1234:2020');
    expect(identityFromKey('tar:roma:ocau:1234:2020', NOW)).toEqual(TAR);
    expect(identityFromKey('tar:atlantide:ocau:1234:2020', NOW)).toBeNull();
    expect(decisionPath(CDS)).toBe('/sentenze/consiglio-di-stato/2270/2019');
    expect(decisionPath({ ...CDS, provvedimento: 'senb' })).toBe('/sentenze/consiglio-di-stato/2270/2019');
    expect(decisionPath(TAR)).toBe('/sentenze/tar-roma/1234/2020?provvedimento=ocau');
    expect(decisionPath({ corte: 'cgars', provvedimento: 'sent', numero: 5, anno: 2020 })).toBe('/sentenze/cgars/5/2020');
    expect(linkableDecisionPath(TAR, NOW)).toBe('/sentenze/tar-roma/1234/2020?provvedimento=ocau');
    expect(linkableDecisionPath({ corte: 'tar', numero: 1, anno: 2020 }, NOW)).toBeNull();
    expect(linkableDecisionPath({ ...CDS, anno: 1989 }, NOW)).toBeNull();
  });

  it('key a reference the words left open apart from the identity, and read it back', () => {
    const lazio = { corte: 'tar' as const, regione: 'Lazio', tipo: 'ordinanza', numero: 1234, anno: 2020 };
    expect(decisionPath(lazio)).toBe('/sentenze/tar/1234/2020?tipo=ordinanza&regione=Lazio');
    expect(decisionPath({ ...CDS, provvedimento: undefined, tipo: 'sentenza' })).toBe('/sentenze/consiglio-di-stato/2270/2019');
    expect(parseDecisionPath({ corte: 'tar', numero: '1234', anno: '2020' }, new URLSearchParams('tipo=ordinanza&regione=Lazio'), NOW))
      .toEqual({ ok: true, reference: lazio });
    expect(parseDecisionPath({ corte: 'tar', numero: '1234', anno: '2020' }, new URLSearchParams(), NOW).ok).toBe(false);
    expect(parseDecisionPath({ corte: 'tar', numero: '1', anno: '2020' }, new URLSearchParams('regione=Atlantide'), NOW).ok).toBe(false);
  });

  it('read their address back, and refuse a number over five digits, a year before 1990 or a kind written otherwise', () => {
    expect(parseDecisionPath({ corte: 'tar-roma', numero: '1234', anno: '2020' }, new URLSearchParams('provvedimento=ocau'), NOW))
      .toEqual({ ok: true, reference: TAR });
    expect(parseDecisionPath({ corte: 'consiglio-di-stato', numero: '2270', anno: '2019' }, new URLSearchParams('sezione=VI'), NOW))
      .toEqual({ ok: true, reference: { corte: 'consiglio_di_stato', numero: 2270, anno: 2019 } });
    expect(parseDecisionPath({ corte: 'consiglio-di-stato', numero: '100000', anno: '2019' }, new URLSearchParams(), NOW).ok).toBe(false);
    expect(parseDecisionPath({ corte: 'cgars', numero: '5', anno: '1989' }, new URLSearchParams(), NOW).ok).toBe(false);
    expect(parseDecisionPath({ corte: 'tar-roma', numero: '5', anno: '2020' }, new URLSearchParams('provvedimento=OCAU'), NOW).ok).toBe(false);
    expect(parseDecisionPath({ corte: 'tar-constructor', numero: '5', anno: '2020' }, new URLSearchParams(), NOW).ok).toBe(false);
  });

  it('write the identity line with the court, the section, the kind, the day and the ECLI', () => {
    expect(formatDecisionHeading(CDS, { tipo: 'sentenza', sezione: 'VI', data_deposito: '2019-04-08', ecli: 'ECLI:IT:CDS:2019:2270SENT' }))
      .toBe("Consiglio di Stato · Sez. VI · Sentenza n. 2270/2019 · depositata l'8 aprile 2019 · ECLI:IT:CDS:2019:2270SENT");
    expect(formatDecisionHeading({ ...TAR, provvedimento: 'dcau' }, { sezione: 'II-quater' }))
      .toBe('TAR Lazio, sede di Roma · Sez. II-quater · Decreto cautelare n. 1234/2020');
    expect(formatDecisionHeading({ ...CDS, provvedimento: 'xyz' }, { sezione: 'plenaria' }))
      .toBe('Consiglio di Stato · Adunanza plenaria · Provvedimento n. 2270/2019');
  });

  it('name the seat deduced from a region, and never claim a decision does not exist anywhere', () => {
    expect(describeNotice({ tipo: 'sede_dedotta', sede: 'Roma' }))
      .toBe('La citazione indica la regione, non la sede: la decisione è del TAR di Roma.');
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'inesistente' }, TAR))
      .toBe("Nessuna ordinanza cautelare n. 1234/2020 (TAR Lazio, Roma) nell'archivio di giustizia-amministrativa.it.");
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'inesistente' }, { corte: 'consiglio_di_stato', numero: 1, anno: 2020 }))
      .toBe("Nessuna sentenza n. 1/2020 (Cons. Stato) nell'archivio di giustizia-amministrativa.it.");
    const missing = { esito: 'non_trovata', motivo: 'inesistente' } as const;
    expect(notFoundMessage(missing, { corte: 'consiglio_di_stato', tipo: 'ordinanza', numero: 3000, anno: 2019 }))
      .toBe("Nessuna ordinanza n. 3000/2019 (Cons. Stato) nell'archivio di giustizia-amministrativa.it.");
    expect(notFoundMessage(missing, { ...TAR, provvedimento: 'dcau' }))
      .toBe("Nessun decreto cautelare n. 1234/2020 (TAR Lazio, Roma) nell'archivio di giustizia-amministrativa.it.");
    expect(notFoundMessage(missing, { corte: 'tar', regione: 'Lombardia', numero: 5, anno: 2020 }))
      .toBe("Nessuna sentenza n. 5/2020 (TAR Lombardia) nell'archivio di giustizia-amministrativa.it.");
  });

  it('abbreviate the kind from the kind the key holds, not from the type', () => {
    expect(formatDecisionCitation(TAR, { sezione: 'I' })).toBe('TAR Lazio, Roma, sez. I, ord., n. 1234/2020');
    expect(formatDecisionCitation({ ...CDS, provvedimento: 'xyz' }, { tipo: 'sentenza' })).toBe('Cons. Stato, n. 2270/2019');
  });

  it('keep in a dossier what the server keeps', () => {
    const kept = sentenzaFromDecision(TAR, { tipo: 'ordinanza', sezione: 'I', ecli: 'x', data_decisione: '2020-01-01' });
    expect(kept).toEqual({ ...TAR, sezione: 'I', tipo: 'ordinanza', etichetta: 'TAR Lazio, Roma, sez. I, ord., n. 1234/2020' });
    expect(parseSentenzaContent(kept, NOW)).toEqual(kept);
    for (const broken of [
      { ...kept, sede: undefined }, { ...kept, sede: 'constructor' }, { ...kept, provvedimento: undefined },
      { ...kept, provvedimento: 'OCAU' }, { ...kept, archivio: 'civile' }, { ...kept, anno: 1989 }, { ...kept, numero: 100000 },
      { ...kept, sezione: 'U' }, { ...kept, corte: 'consiglio_di_stato' }, { ...kept, data_decisione: '2020-01-01' },
      { ...kept, tipo: 'sentenza' }, { ...kept, tipo: 'ordinanza interlocutoria' },
      { corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2020, provvedimento: 'sent', etichetta: 'x' },
    ]) {
      expect(parseSentenzaContent(JSON.parse(JSON.stringify(broken)), NOW)).toBeNull();
    }
  });

  it('are read in the palette as the API reads them, a parere left to the API', () => {
    expect(parseDecisionCitation('TAR Lazio, sez. II-quater, ord. n. 12/2021', { now: NOW }))
      .toEqual({ corte: 'tar', regione: 'Lazio', sezione: 'II-quater', tipo: 'ordinanza', numero: 12, anno: 2021 });
    expect(parseDecisionCitation("T.A.R. Abruzzo, L'Aquila, n. 3/2022", { now: NOW }))
      .toEqual({ corte: 'tar', sede: 'l-aquila', numero: 3, anno: 2022 });
    expect(parseDecisionCitation('Cons. Stato, parere n. 2270/2019', { now: NOW })).toBeNull();
    expect(parseDecisionCitation('TRGA, n. 1/2020', { now: NOW })).toBeNull();
    // a type the kind does not have is not kept
    expect(sentenzaFromDecision(TAR, { tipo: 'sentenza' }).tipo).toBeUndefined();
  });

  it('read a long hostile paste quickly', () => {
    for (const hostile of ['TAR ' + 'Lazio '.repeat(2000), 'Cons. Stato, sez. ' + 'I-'.repeat(3000), 'T.A.R. ' + 'n. 1 '.repeat(3000)]) {
      const start = performance.now();
      parseDecisionCitation(hostile, { now: NOW });
      expect(performance.now() - start).toBeLessThan(200);
    }
  });

  it('survive in a practice with closed values only', () => {
    expect(storedReference({ ...TAR, extra: 'x' })).toEqual(TAR);
    expect(storedReference({ corte: 'tar', regione: 'Lazio', tipo: 'ordinanza', numero: 1, anno: 2020 }))
      .toEqual({ corte: 'tar', regione: 'Lazio', tipo: 'ordinanza', numero: 1, anno: 2020 });
    expect(storedReference({ corte: 'tar', sede: 'atlantide', numero: 1, anno: 2020 })).toBeNull();
    expect(storedReference({ ...CDS, provvedimento: '<b>' })).toEqual({ corte: 'consiglio_di_stato', numero: 2270, anno: 2019 });
  });
});
