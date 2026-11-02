import type { EsitoRisposta, ModuloLezione } from '../../../../types/corsi';
import type { Span } from './lessonFormat';
import type { FaseRichiamo } from './RecallStep';

/**
 * The steps of a module's session (courses spec §5, §6.5): «Passo 4 di 11 · Richiamo», never a bar of every step. This
 * pull request (b) draws the start, the reading and the recall of each block, then a waiting screen; the quiz, the open
 * question and the end are (c), which replaces that screen with its steps.
 */
export type Passo =
  /** What the module is for, its pre-questions (§5, step 1), and «Inizia il modulo». */
  | { tipo: 'inizio' }
  | { tipo: 'lettura'; blocco: number }
  | { tipo: 'richiamo'; blocco: number }
  /** After the last recall, until pull request (c) brings the quiz (§5, step 5): counted as no step. */
  | { tipo: 'attesa' };

export function moduleSteps(modulo: Pick<ModuloLezione, 'blocchi'>): Passo[] {
  return [
    { tipo: 'inizio' },
    ...modulo.blocchi.flatMap((_, blocco): Passo[] => [
      { tipo: 'lettura', blocco },
      { tipo: 'richiamo', blocco },
    ]),
    { tipo: 'attesa' },
  ];
}

export const STEP_NAME: Record<Passo['tipo'], string> = {
  inizio: 'Prima di leggere',
  lettura: 'Lettura',
  richiamo: 'Richiamo',
  attesa: 'Fine della lettura',
};

/** «Passo 4 di 9 · Richiamo»: the waiting screen is no step, and says only «Fine della lettura». */
export function stepLine(index: number, steps: readonly Passo[]): string {
  const step = steps[index];
  if (step.tipo === 'attesa') return STEP_NAME.attesa;
  return `Passo ${index + 1} di ${steps.filter((s) => s.tipo !== 'attesa').length} · ${STEP_NAME[step.tipo]}`;
}

/** A comfort pause is suggested every 25 minutes or so (§5, step 2): a suggestion, never a timer that closes anything. */
export const PAUSE_EVERY_MS = 25 * 60 * 1000;

/** What closing loses (§6.5: «Quello che hai scritto si perde»); highlights are lost too, and said. */
export function stopMessage(written: boolean, highlighted: boolean): string {
  const lost = written && highlighted ? 'Quello che hai scritto e le evidenziazioni si perdono.' : written ? 'Quello che hai scritto si perde.' : 'Le evidenziazioni si perdono.';
  return `${lost} Le risposte date restano registrate e il passo raggiunto resta su questo dispositivo.`;
}

const STORAGE_KEY = 'visualex.studia.percorsi.passo';
/** The session's work on a module's blocks, in this tab only (`sessionStorage`). */
const WORK_KEY = 'visualex.studia.percorsi.lavoro';

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

/**
 * Forgets what this browser kept of the modules: the steps reached and the work of this tab. At every sign-in, sign-up
 * and sign-out (`useAuth`), as `seenProgress` (G-316): the next person on the browser never finds the last one's recall.
 */
export function forgetModuleSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: nothing was kept.
  }
  try {
    sessionStorage.removeItem(WORK_KEY);
  } catch {
    // Private mode: nothing was kept.
  }
}

/** A block's highlights, free recall and recall phase: the session's alone, never sent (§8). */
export interface BlockWork {
  spans: Span[];
  scritto: string;
  fase: FaseRichiamo;
}

export const EMPTY_WORK: BlockWork = { spans: [], scritto: '', fase: 'scrivi' };

const PHASES: readonly FaseRichiamo[] = ['scrivi', 'confronta', 'domande'];
const isSpan = (v: unknown): v is Span => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0) && v[1] > v[0];
const isWork = (v: unknown): v is BlockWork => {
  const w = v as Partial<BlockWork> | null;
  return !!w && typeof w === 'object' && typeof w.scritto === 'string' && PHASES.includes(w.fase as FaseRichiamo) && Array.isArray(w.spans) && w.spans.every(isSpan);
};
const hasWork = (w: BlockWork) => w.scritto !== '' || w.spans.length > 0 || w.fase !== 'scrivi';

function readAllWork(): Record<string, Record<string, BlockWork>> {
  try {
    const raw = sessionStorage.getItem(WORK_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Record<string, BlockWork>>) : {};
  } catch {
    return {};
  }
}

/**
 * A module's work kept in this tab (§6.5, review of #374): the free recall, the highlights and the recall's phase survive
 * a reload, the browser's back and a swipe back, and return with the module; they go with the tab, with «Interrompi»
 * and at sign-in or sign-out. `sessionStorage`, never the server (§8). What does not read as work is dropped.
 */
export function readWork(moduloId: string): Record<string, BlockWork> {
  const stored = readAllWork()[moduloId];
  if (!stored || typeof stored !== 'object') return {};
  return Object.fromEntries(Object.entries(stored).filter(([, w]) => isWork(w)));
}

export function saveWork(moduloId: string, work: Record<string, BlockWork>): void {
  const kept = Object.fromEntries(Object.entries(work).filter(([, w]) => hasWork(w)));
  const all = readAllWork();
  if (Object.keys(kept).length > 0) all[moduloId] = kept;
  else delete all[moduloId];
  try {
    if (Object.keys(all).length > 0) sessionStorage.setItem(WORK_KEY, JSON.stringify(all));
    else sessionStorage.removeItem(WORK_KEY);
  } catch {
    // Private mode or a full store: the work lives as long as the page.
  }
}

export const forgetWork = (moduloId: string) => saveWork(moduloId, {});

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
              // A first answer is never flagged yet; the answer does not carry the day it was graded.
              risposta: { scelta: esito.scelta, corretto: esito.corretto, corretta: esito.corretta, segnalata: domanda.risposta?.segnalata ?? false },
            },
      ),
    })),
  };
}
