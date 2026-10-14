import { describe, expect, it } from 'vitest';
import { keyPassageText, keyPassages } from '../decisionKeyPassages';
import { previewKeyPassage, previewLines } from '../decisionPreview';
import { decisionProjection } from '../decisionRender';

// Synthetic texts written for these tests: no court's words.
const PRINCIPLE = 'il fornitore che consegna in ritardo la merce deperibile\nrisponde del danno anche quando il ritardo dipende dal vettore';

describe('previewKeyPassage', () => {
  it('prefers the principle of law, read with each line break as a space', () => {
    const testo = {
      motivazione: `FATTI DI CAUSA\n\nMario Rossi ricorre contro Bianchi s.r.l.\n\nLa Corte enuncia il seguente principio di diritto: «${PRINCIPLE}».`,
      dispositivo: 'P.Q.M.\n\nLa Corte accoglie il ricorso.',
    };
    expect(previewKeyPassage(testo, 'cassazione')).toEqual({ kind: 'principio', text: PRINCIPLE.replace('\n', ' ') });
  });

  it('falls back to the dispositivo, and to nothing where the rules find nothing or for another court', () => {
    const testo = { motivazione: 'Mario Rossi ricorre.', dispositivo: 'P.Q.M.\n\nLa Corte rigetta\nil ricorso e condanna il ricorrente al pagamento delle spese.' };
    expect(previewKeyPassage(testo, 'cassazione')).toEqual({ kind: 'dispositivo', text: 'La Corte rigetta il ricorso' });
    expect(previewKeyPassage({ motivazione: 'Mario Rossi ricorre.' }, 'cassazione')).toBeNull();
    expect(previewKeyPassage(testo, 'consiglio_di_stato')).toBeNull();
  });

  it('cuts a long passage as the first lines are cut', () => {
    const long = 'parola '.repeat(200).trim();
    const found = previewKeyPassage({ motivazione: `La Corte enuncia il seguente principio di diritto: «${long}».` }, 'cassazione');
    expect(found?.text.length).toBeLessThanOrEqual(601);
    expect(found?.text.endsWith('…')).toBe(true);
  });

  it('leaves the first lines as they were for a decision without passages', () => {
    expect(previewLines({ epigrafe: 'REPUBBLICA ITALIANA\nLA CORTE' })).toBe('REPUBBLICA ITALIANA\nLA CORTE');
  });
});

describe('keyPassageText', () => {
  it('gives the words of a passage in a later block, its lines joined by a space', () => {
    const testo = { epigrafe: 'TESTA\nDELLA DECISIONE', motivazione: 'Il motivo.', dispositivo: 'P.Q.M.\n\nLa Corte\naccoglie\nil ricorso.' };
    const [passage] = keyPassages(testo, 'cassazione');
    expect(keyPassageText(testo, passage)).toBe('La Corte accoglie il ricorso.');
  });
});

describe('keyPassageText — in linear time', () => {
  it('reads a passage holding a long run of spaces and a few line breaks quickly', () => {
    const motivazione = `il fornitore${' '.repeat(50000)}risponde\ndel danno\nanche quando il ritardo dipende dal vettore`;
    const testo = { motivazione };
    const started = performance.now();
    const text = keyPassageText(testo, { kind: 'principio', start: 0, end: decisionProjection(testo).length });
    expect(performance.now() - started).toBeLessThan(250);
    expect(text.endsWith('risponde del danno anche quando il ritardo dipende dal vettore')).toBe(true);
  });
});
