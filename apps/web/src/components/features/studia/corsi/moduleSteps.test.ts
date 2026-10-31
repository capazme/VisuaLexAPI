import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_WORK, forgetModuleSessions, forgetWork, moduleSteps, readStepReached, readWork, saveStepReached, saveWork, stepLine, stopMessage, withOutcome } from './moduleSteps';
import { lesson } from './__fixtures__/corsi';

afterEach(() => forgetModuleSessions());

describe('a module\'s steps (§5, §6.5)', () => {
  it('are the start, each block\'s reading and recall, and the quiz', () => {
    const steps = moduleSteps(lesson());
    expect(steps.map((s) => s.tipo)).toEqual(['inizio', 'lettura', 'richiamo', 'lettura', 'richiamo', 'attesa']);
    expect(stepLine(2, steps)).toBe('Passo 3 di 5 · Richiamo');
    expect(stepLine(0, steps)).toBe('Passo 1 di 5 · Prima di leggere');
    // The waiting screen until the quiz (pull request c) is no step, and names no quiz.
    expect(stepLine(5, steps)).toBe('Fine della lettura');
  });

  it('keeps the step reached on this device, within the module\'s steps, until a sign-in or sign-out forgets it', () => {
    saveStepReached('m-3', 4);
    saveStepReached('m-4', 2);
    expect(readStepReached('m-3', 6)).toBe(4);
    expect(readStepReached('m-3', 4)).toBeNull();
    expect(readStepReached('m-9', 6)).toBeNull();
    forgetModuleSessions();
    expect(readStepReached('m-4', 6)).toBeNull();
  });

  it('reads nothing from a stored value that is not a map of steps', () => {
    localStorage.setItem('visualex.studia.percorsi.passo', '[1,2]');
    expect(readStepReached('0', 6)).toBeNull();
    localStorage.setItem('visualex.studia.percorsi.passo', '{"m-3":"2"}');
    expect(readStepReached('m-3', 6)).toBeNull();
  });
});

describe('a module\'s work kept in this tab (review of #374)', () => {
  it('keeps the recall, the highlights and the phase per module, drops what is empty or does not read as work', () => {
    saveWork('m-3', { 'b-1': { spans: [[2, 9]], scritto: 'ricordo', fase: 'confronta' }, 'b-2': EMPTY_WORK });
    saveWork('m-4', { 'b-9': { ...EMPTY_WORK, scritto: 'altro' } });
    expect(readWork('m-3')).toEqual({ 'b-1': { spans: [[2, 9]], scritto: 'ricordo', fase: 'confronta' } });
    sessionStorage.setItem('visualex.studia.percorsi.lavoro', JSON.stringify({ 'm-5': { 'b-1': { spans: [[9, 2]], scritto: 'x', fase: 'scrivi' }, 'b-2': { scritto: 3 } } }));
    expect(readWork('m-5')).toEqual({});
  });

  it('forgets one module with «Interrompi», and every module at sign-in or sign-out', () => {
    saveWork('m-3', { 'b-1': { ...EMPTY_WORK, scritto: 'ricordo' } });
    saveWork('m-4', { 'b-9': { ...EMPTY_WORK, scritto: 'altro' } });
    forgetWork('m-3');
    expect(readWork('m-3')).toEqual({});
    expect(readWork('m-4')).not.toEqual({});
    saveStepReached('m-4', 2);
    forgetModuleSessions();
    expect(readWork('m-4')).toEqual({});
    expect(readStepReached('m-4', 6)).toBeNull();
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
