import { describe, expect, it } from 'vitest';
import {
  decisionKey,
  decisionPath,
  describeNotice,
  formatDecisionHeading,
  identityFromKey,
  linkableDecisionPath,
  notFoundMessage,
  parseDecisionPath,
} from '../decisionLinks';
import { parseSentenzaContent, sentenzaFromDecision } from '../../components/features/dossier/dossierUtils';

// The courts of the Union (design 2026-10-12 §3): what the golden file does not pin — the page's
// address read back, the identity line, the notices and the dossier entry.
const NOW = new Date('2026-10-12T12:00:00Z');
const CGUE = { corte: 'corte_giustizia_ue' as const, numero: 293, anno: 2012 };

describe('the courts of the Union', () => {
  it('read their address back, and refuse a case number over four digits or a year before the court', () => {
    expect(parseDecisionPath({ corte: 'corte-giustizia-ue', numero: '634', anno: '2021' }, new URLSearchParams(), NOW))
      .toEqual({ ok: true, reference: { corte: 'corte_giustizia_ue', numero: 634, anno: 2021 } });
    expect(parseDecisionPath({ corte: 'tribunale-ue', numero: '612', anno: '2017' }, new URLSearchParams('sezione=I'), NOW))
      .toEqual({ ok: true, reference: { corte: 'tribunale_ue', numero: 612, anno: 2017 } });
    expect(parseDecisionPath({ corte: 'corte-giustizia-ue', numero: '10000', anno: '2021' }, new URLSearchParams(), NOW).ok).toBe(false);
    expect(parseDecisionPath({ corte: 'tribunale-ue', numero: '1', anno: '1988' }, new URLSearchParams(), NOW).ok).toBe(false);
  });

  it('keep the key and the path the convention gives them', () => {
    expect(decisionKey(CGUE)).toBe('corte_giustizia_ue:293:2012');
    expect(identityFromKey('corte_giustizia_ue:293:2012', NOW)).toEqual(CGUE);
    expect(decisionPath(CGUE)).toBe('/sentenze/corte-giustizia-ue/293/2012');
    expect(linkableDecisionPath({ corte: 'tribunale_ue', numero: 612, anno: 2017 }, NOW)).toBe('/sentenze/tribunale-ue/612/2017');
  });

  it('write the identity line with the formation, the joined cases, the day, the parties and the ECLI', () => {
    expect(formatDecisionHeading(CGUE, {
      tipo: 'sentenza', sezione: 'grande', data_decisione: '2014-04-08', parti: 'A contro B',
      ecli: 'ECLI:EU:C:2014:238', cause_riunite: ['C-293/12', 'C-594/12'],
    })).toBe("Corte di giustizia dell'Unione europea · Grande Sezione · Sentenza, cause riunite C-293/12 e C-594/12 · "
      + "pronunciata l'8 aprile 2014 · A contro B · ECLI:EU:C:2014:238");
  });

  it('say where a joined case is filed, and never claim a case has no judgment for good', () => {
    expect(describeNotice({ tipo: 'causa_riunita', numero: '293', anno: '2012' }))
      .toBe('La causa citata è stata riunita ad altre: la sentenza è registrata sotto la causa n. 293/2012.');
    expect(notFoundMessage({ esito: 'non_trovata', motivo: 'inesistente' }, { corte: 'corte_giustizia_ue', numero: 9, anno: 2024 }))
      .toMatch(/^Nessuna sentenza della causa C-9\/24 .*ancora pendente\.$/);
  });

  it('keep in a dossier what the server keeps, and nothing of the Cassazione', () => {
    const kept = sentenzaFromDecision(CGUE, {
      tipo: 'sentenza', sezione: 'grande', data_decisione: '2014-04-08', data_deposito: '2014-04-09',
      ecli: 'x', parti: 'y', cause_riunite: ['C-293/12', 'C-594/12'],
    });
    expect(kept).toEqual({
      ...CGUE, sezione: 'grande', tipo: 'sentenza', data_decisione: '2014-04-08', cause_riunite: ['C-293/12', 'C-594/12'],
      etichetta: 'Corte giust. UE, grande sez., sent. 8 aprile 2014, cause riunite C-293/12 e C-594/12',
    });
    expect(parseSentenzaContent(kept, NOW)).toEqual(kept);
    expect(parseSentenzaContent({ ...kept, archivio: 'civile' }, NOW)).toBeNull();
    expect(parseSentenzaContent({ ...kept, sezione: 'U' }, NOW)).toBeNull();
    expect(parseSentenzaContent({ ...kept, numero: 10000 }, NOW)).toBeNull();
    expect(parseSentenzaContent({ ...kept, cause_riunite: ['C-293/12', 'altro'] }, NOW)).toBeNull();
    expect(parseSentenzaContent({ corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2020, data_decisione: '2020-01-01', etichetta: 'x' }, NOW)).toBeNull();
  });
});

describe('a judgment on many joined cases', () => {
  const cases = (n: number) => Array.from({ length: n }, (_, i) => `T-${i + 1}/05`);
  it('names up to 30 of them in a label the dossier keeps', () => {
    const kept = sentenzaFromDecision({ corte: 'tribunale_ue', numero: 1, anno: 2005 }, { tipo: 'sentenza', cause_riunite: cases(30) });
    expect(kept.cause_riunite).toHaveLength(30);
    expect(kept.etichetta.length).toBeGreaterThan(200);
    expect(parseSentenzaContent(kept, NOW)).toEqual(kept);
  });
  it('names the case alone past 30', () => {
    const kept = sentenzaFromDecision({ corte: 'tribunale_ue', numero: 1, anno: 2005 }, { tipo: 'sentenza', cause_riunite: cases(31) });
    expect(kept.cause_riunite).toBeUndefined();
    expect(kept.etichetta).toBe('Trib. UE, sent., causa T-1/05');
    expect(parseSentenzaContent(kept, NOW)).toEqual(kept);
  });
});
