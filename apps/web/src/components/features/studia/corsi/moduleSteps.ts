import type { EsitoRisposta, ModuloLezione } from '../../../../types/corsi';

/**
 * The steps of a module's session (courses spec §5, §6.5): «Passo 4 di 11 · Richiamo», never a bar of every step. This
 * pull request (b) draws the start, the reading and the recall of each block; the quiz, the open question and the end are
 * (c), which replaces the last step.
 */
export type Passo =
  /** What the module is for, its pre-questions (§5, step 1), and «Inizia il modulo». */
  | { tipo: 'inizio' }
  | { tipo: 'lettura'; blocco: number }
  | { tipo: 'richiamo'; blocco: number }
  /** The quiz (§5, step 5): pull request (c). */
  | { tipo: 'quiz' };

export function moduleSteps(modulo: Pick<ModuloLezione, 'blocchi'>): Passo[] {
  return [
    { tipo: 'inizio' },
    ...modulo.blocchi.flatMap((_, blocco): Passo[] => [
      { tipo: 'lettura', blocco },
      { tipo: 'richiamo', blocco },
    ]),
    { tipo: 'quiz' },
  ];
}

export const STEP_NAME: Record<Passo['tipo'], string> = {
  inizio: 'Prima di leggere',
  lettura: 'Lettura',
  richiamo: 'Richiamo',
  quiz: 'Quiz',
};

/** «Passo 4 di 11 · Richiamo». */
export const stepLine = (index: number, steps: readonly Passo[]) => `Passo ${index + 1} di ${steps.length} · ${STEP_NAME[steps[index].tipo]}`;

/** A comfort pause is suggested every 25 minutes or so (§5, step 2): a suggestion, never a timer that closes anything. */
export const PAUSE_EVERY_MS = 25 * 60 * 1000;

/** What closing loses (§6.5: «Quello che hai scritto si perde»); highlights are lost too, and said. */
export function stopMessage(written: boolean, highlighted: boolean): string {
  const lost = written && highlighted ? 'Quello che hai scritto e le evidenziazioni si perdono.' : written ? 'Quello che hai scritto si perde.' : 'Le evidenziazioni si perdono.';
  return `${lost} Le risposte date restano registrate e il passo raggiunto resta su questo dispositivo.`;
}

const STORAGE_KEY = 'visualex.studia.percorsi.passo';

/**
 * The step reached, kept on this device only (§6.5, §8: it never reaches the server) and forgotten at every sign-in,
 * sign-up and sign-out with the rest of what this browser drew of Gymnasium (`useAuth`, as `seenProgress`, G-316).
 * Private mode or a full store keep nothing: the module starts again from its first step.
 */
function readAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The step reached in a module, if this browser kept one within its steps. */
export function readStepReached(moduloId: string, count: number): number | null {
  const step = readAll()[moduloId];
  return Number.isInteger(step) && step > 0 && step < count ? step : null;
}

export function saveStepReached(moduloId: string, step: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [moduloId]: step }));
  } catch {
    // Private mode or a full store: the module starts again from its first step.
  }
}

export function forgetStepsReached(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: nothing was kept.
  }
}

/**
 * The module with one recall question graded as the server answered (`POST …/risposte`): its outcome and every option's
 * explanation. An answer opens the module on the server (§10.4), so a module «da iniziare» is «in corso» from it.
 */
export function withOutcome(modulo: ModuloLezione, domandaId: string, esito: EsitoRisposta): ModuloLezione {
  const explained = new Map(esito.opzioni.map((o) => [o.chiave, o.spiegazione]));
  return {
    ...modulo,
    stato: modulo.stato === 'da-iniziare' ? 'in-corso' : modulo.stato,
    blocchi: modulo.blocchi.map((blocco) => ({
      ...blocco,
      richiamo: blocco.richiamo.map((domanda) =>
        domanda.id !== domandaId
          ? domanda
          : {
              ...domanda,
              opzioni: domanda.opzioni.map((o) => ({ ...o, spiegazione: explained.get(o.chiave) ?? o.spiegazione })),
              risposta: { scelta: esito.scelta, corretto: esito.corretto, corretta: esito.corretta },
            },
      ),
    })),
  };
}
