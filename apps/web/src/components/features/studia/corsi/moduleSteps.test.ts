import { afterEach, describe, expect, it } from 'vitest';
import { forgetStepsReached, moduleSteps, readStepReached, saveStepReached, stepLine, stopMessage, withOutcome } from './moduleSteps';
import { lesson } from './__fixtures__/corsi';

afterEach(() => forgetStepsReached());

describe('a module\'s steps (§5, §6.5)', () => {
  it('are the start, each block\'s reading and recall, and the quiz', () => {
    const steps = moduleSteps(lesson());
    expect(steps.map((s) => s.tipo)).toEqual(['inizio', 'lettura', 'richiamo', 'lettura', 'richiamo', 'quiz']);
    expect(stepLine(2, steps)).toBe('Passo 3 di 6 · Richiamo');
    expect(stepLine(0, steps)).toBe('Passo 1 di 6 · Prima di leggere');
  });

  it('keeps the step reached on this device, within the module\'s steps, until a sign-in or sign-out forgets it', () => {
    saveStepReached('m-3', 4);
    saveStepReached('m-4', 2);
    expect(readStepReached('m-3', 6)).toBe(4);
    expect(readStepReached('m-3', 4)).toBeNull();
    expect(readStepReached('m-9', 6)).toBeNull();
    forgetStepsReached();
    expect(readStepReached('m-4', 6)).toBeNull();
  });

  it('reads nothing from a stored value that is not a map of steps', () => {
    localStorage.setItem('visualex.studia.percorsi.passo', '[1,2]');
    expect(readStepReached('0', 6)).toBeNull();
    localStorage.setItem('visualex.studia.percorsi.passo', '{"m-3":"2"}');
    expect(readStepReached('m-3', 6)).toBeNull();
  });
});

describe('an answer merged into the module', () => {
  it('writes the outcome and the explanations on its item alone, and opens a module not started', () => {
    const merged = withOutcome(lesson(), 'd-1', {
      registrata: true,
      domandaId: 'd-1',
      xp: null,
      scelta: 'a',
      corretto: true,
      corretta: 'a',
      opzioni: [
        { chiave: 'a', testo: 'A', spiegazione: 'Perché sì.' },
        { chiave: 'b', testo: 'B', spiegazione: 'Perché no.' },
      ],
    });
    expect(merged.stato).toBe('in-corso');
    const item = merged.blocchi[0].richiamo[0];
    expect(item.risposta).toEqual({ scelta: 'a', corretto: true, corretta: 'a', segnalata: false });
    expect(item.opzioni.map((o) => o.spiegazione)).toEqual(['Perché sì.', 'Perché no.']);
    expect(item.opzioni[0].testo).toBe('I prodotti o i servizi di un’impresa');
    expect(merged.blocchi[1]).toEqual(lesson().blocchi[1]);
  });
});

describe('the question before leaving (§6.5)', () => {
  it('names what is lost, and what stays', () => {
    expect(stopMessage(true, false)).toMatch(/^Quello che hai scritto si perde\. Le risposte date restano registrate/);
    expect(stopMessage(false, true)).toMatch(/^Le evidenziazioni si perdono\./);
    expect(stopMessage(true, true)).toMatch(/^Quello che hai scritto e le evidenziazioni si perdono\./);
  });
});
