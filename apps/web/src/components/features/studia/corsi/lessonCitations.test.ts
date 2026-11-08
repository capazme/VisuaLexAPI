import { describe, expect, it } from 'vitest';
import type { CitazioneLezione } from '../../../../types/corsi';
import { citationLabel, decisionOfCitation, normaOfCitation } from './lessonCitations';

const norm = (riferimento: Record<string, unknown>, citation: string | null = 'art. 7 c.p.i.'): CitazioneLezione => ({ marcatore: 'c1', voce: 'v', tipo: 'norm', riferimento, citation });
const decision = (riferimento: Record<string, unknown>): CitazioneLezione => ({ marcatore: 'c2', voce: 'v', tipo: 'sentenza', riferimento, citation: null });

describe('a lesson\'s citation, read as untrusted data (§10.3)', () => {
  it('opens a norm from its act and article, keeping only the known fields as text', () => {
    expect(normaOfCitation(norm({ tipo_atto: 'codice civile', numero_articolo: '2569', versione: 'vigente', onerror: 'x', data: 7 }))).toEqual({
      tipo_atto: 'codice civile',
      numero_articolo: '2569',
      data: '',
      versione: 'vigente',
    });
    expect(normaOfCitation(norm({ tipo_atto: 'codice civile' }))).toBeNull();
    expect(normaOfCitation(decision({ tipo_atto: 'codice civile', numero_articolo: '1' }))).toBeNull();
  });

  it('opens a decision only when the dossier would hold it', () => {
    expect(decisionOfCitation(decision({ corte: 'cassazione', numero: 1234, anno: 2020, archivio: 'civile', etichetta: 'Cass. civ., n. 1234/2020' }))).toEqual({
      corte: 'cassazione',
      numero: 1234,
      anno: 2020,
      archivio: 'civile',
    });
    expect(decisionOfCitation(decision({ corte: 'cassazione', numero: 1234, anno: 2020, etichetta: 'x', script: '<b>' }))).toBeNull();
  });

  it('is named by the server\'s citation, else by what it is', () => {
    expect(citationLabel(norm({}, 'art. 7 c.p.i.'))).toBe('art. 7 c.p.i.');
    expect(citationLabel(norm({}, null))).toBe('La norma citata');
    expect(citationLabel(decision({}))).toBe('La sentenza citata');
  });
});
