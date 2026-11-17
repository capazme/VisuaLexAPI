import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { FIELD_TEXT } from '../../../../constants/interactions';
import { cn } from '../../../../lib/utils';
import { studiaService } from '../../../../services/studiaService';
import type { EsercizioLezione, EsitoEsercizio, Lezione, Materia, RispostaEsercizio } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { BLOCK_HEADING, FOCUS_RING, INK_BG, INK_BUTTON, INK_TEXT, MUTED_TEXT, SECONDARY_BUTTON, SUCCESS_TEXT, TILE } from '../progress/tokens';
import { gainLabel, gainOf, gainSentence } from '../progress/xpGains';

const HOME = '/learn/ripasso';

const isMateria = (value: string | null): value is Materia => value !== null && value in MATERIA_LABEL;

/** The server's own words for a refusal (409 too few cards, 429 too many lessons today), else null. */
function refusal(error: unknown): string | null {
  const detail = (error as { data?: { detail?: unknown } } | null)?.data?.detail;
  return typeof detail === 'string' ? detail : null;
}

const PROMPT: Record<EsercizioLezione['tipo'], string> = {
  scelta: 'Scegli la risposta giusta',
  'vero-falso': 'Vero o falso?',
  completa: 'Completa la risposta',
  abbina: 'Abbina ogni articolo al suo istituto',
};

/** The right answer in words, for the correction. */
function solutionWords(exercise: EsercizioLezione, solution: RispostaEsercizio): string {
  if (exercise.tipo === 'vero-falso') return solution ? 'Vero' : 'Falso';
  if (exercise.tipo === 'abbina') return exercise.norme.map((norma, i) => `${norma} → ${exercise.istituti[(solution as number[])[i]]}`).join('; ');
  return exercise.opzioni[solution as number];
}

/** «La risposta giusta: …» ends with one full stop, whatever the card's text ends with. */
const sentence = (text: string) => `${text.replace(/[.\s]+$/, '')}.`;

const OPTION = cn(
  'flex min-h-[48px] w-full items-center rounded-xl border-2 px-4 py-3 text-left text-base leading-snug transition-[background-color,border-color,scale] active:scale-[0.99] aria-disabled:active:scale-100',
  FOCUS_RING,
);
const OPTION_IDLE = 'border-slate-200 bg-card hover:border-primary-700 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-primary-300';
const OPTION_RIGHT = 'border-green-700 bg-green-50 text-green-900 dark:border-green-400 dark:bg-green-950/40 dark:text-green-100';
const OPTION_WRONG = 'border-red-700 bg-red-50 text-red-900 dark:border-red-400 dark:bg-red-950/40 dark:text-red-100';
const OPTION_DIM = 'border-slate-200 bg-card text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400';

/** Buttons that answer at a tap: a choice, a word, true or false. */
function Options({ labels, values, chosen, graded, onAnswer, busy }: {
  labels: string[];
  values: RispostaEsercizio[];
  chosen: RispostaEsercizio | null;
  graded: EsitoEsercizio | null;
  onAnswer: (value: RispostaEsercizio) => void;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {labels.map((label, i) => {
        const value = values[i];
        const isChosen = chosen === value;
        const state = !graded ? (isChosen && busy ? 'chosen' : 'idle') : value === graded.soluzione ? 'right' : isChosen ? 'wrong' : 'dim';
        return (
          <button
            key={label + i}
            type="button"
            // Not `disabled`: a disabled button drops the focus to the page, and the keyboard would lose its place.
            aria-disabled={graded !== null || busy}
            onClick={() => {
              if (graded === null && !busy) onAnswer(value);
            }}
            className={cn(
              OPTION,
              state === 'idle' && OPTION_IDLE,
              state === 'chosen' && 'border-primary-700 bg-primary-50 dark:border-primary-300 dark:bg-primary-900/30',
              state === 'right' && OPTION_RIGHT,
              state === 'wrong' && OPTION_WRONG,
              state === 'dim' && OPTION_DIM,
            )}
          >
            <span className="[overflow-wrap:anywhere]">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The match: a select per article, sent once each has an institute. */
function Match({ exercise, graded, busy, onAnswer }: {
  exercise: Extract<EsercizioLezione, { tipo: 'abbina' }>;
  graded: EsitoEsercizio | null;
  busy: boolean;
  onAnswer: (value: number[]) => void;
}) {
  const [picks, setPicks] = useState<(number | null)[]>(() => exercise.norme.map(() => null));
  const solution = graded?.soluzione as number[] | undefined;
  return (
    <form
      className="grid grid-cols-1 gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && picks.every((p) => p !== null)) onAnswer(picks as number[]);
      }}
    >
      {exercise.norme.map((norma, i) => {
        const id = `abbina-${i}`;
        const right = solution ? solution[i] === picks[i] : null;
        return (
          <div key={norma} className={cn(TILE, 'grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center')}>
            <label htmlFor={id} className="font-serif text-lg leading-snug text-slate-900 dark:text-slate-50">
              {norma}
            </label>
            <div className="grid gap-1">
              <select
                id={id}
                value={picks[i] ?? ''}
                disabled={graded !== null || busy}
                onChange={(event) => {
                  const value = event.target.value === '' ? null : Number(event.target.value);
                  setPicks((current) => current.map((p, j) => (j === i ? value : p)));
                }}
                className={cn(
                  'min-h-[44px] w-full rounded-lg border bg-card px-3 dark:bg-slate-900',
                  FIELD_TEXT,
                  right === null ? 'border-slate-300 dark:border-slate-700' : right ? 'border-green-700 dark:border-green-400' : 'border-red-700 dark:border-red-400',
                  FOCUS_RING,
                )}
              >
                <option value="">Scegli l’istituto</option>
                {exercise.istituti.map((istituto, k) => (
                  <option key={istituto} value={k}>
                    {istituto}
                  </option>
                ))}
              </select>
              {solution && !right && <span className={cn('text-sm', MUTED_TEXT)}>Giusto: {exercise.istituti[solution[i]]}</span>}
            </div>
          </div>
        );
      })}
      {!graded && (
        <button type="submit" disabled={picks.some((p) => p === null)} aria-disabled={busy} className={cn(INK_BUTTON, 'w-full sm:w-auto sm:justify-self-end')}>
          Verifica
        </button>
      )}
    </form>
  );
}

function Exercise({ exercise, graded, chosen, busy, onAnswer }: {
  exercise: EsercizioLezione;
  graded: EsitoEsercizio | null;
  chosen: RispostaEsercizio | null;
  busy: boolean;
  onAnswer: (value: RispostaEsercizio) => void;
}) {
  // A new exercise takes the focus at its prompt, so the keyboard and a screen reader start from it.
  const prompt = useRef<HTMLParagraphElement>(null);
  useEffect(() => prompt.current?.focus(), []);
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid gap-2">
        <p ref={prompt} tabIndex={-1} className={cn('text-sm font-semibold focus:outline-none', INK_TEXT)}>{PROMPT[exercise.tipo]}</p>
        {exercise.tipo !== 'abbina' && <h2 className="font-serif text-2xl leading-snug text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">{exercise.domanda}</h2>}
      </div>
      {exercise.tipo === 'vero-falso' && (
        <>
          <blockquote className={cn(TILE, 'px-4 py-3 text-base leading-relaxed [overflow-wrap:anywhere]')}>{exercise.affermazione}</blockquote>
          <Options labels={['Vero', 'Falso']} values={[true, false]} chosen={chosen} graded={graded} busy={busy} onAnswer={onAnswer} />
        </>
      )}
      {exercise.tipo === 'completa' && (
        <>
          <p className={cn(TILE, 'px-4 py-3 text-base leading-relaxed [overflow-wrap:anywhere]')}>{exercise.testo}</p>
          <Options labels={exercise.opzioni} values={exercise.opzioni.map((_, i) => i)} chosen={chosen} graded={graded} busy={busy} onAnswer={onAnswer} />
        </>
      )}
      {exercise.tipo === 'scelta' && (
        <Options labels={exercise.opzioni} values={exercise.opzioni.map((_, i) => i)} chosen={chosen} graded={graded} busy={busy} onAnswer={onAnswer} />
      )}
      {exercise.tipo === 'abbina' && <Match exercise={exercise} graded={graded} busy={busy} onAnswer={onAnswer} />}
    </div>
  );
}

function EndScreen({ fine, onAgain }: { fine: NonNullable<EsitoEsercizio['fine']>; onAgain: () => void }) {
  const gain = gainOf('lezione', fine.xp);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-labelledby="lezione-fine" className="grid grid-cols-1 justify-items-start gap-4">
      <h2 id="lezione-fine" ref={heading} tabIndex={-1} className={cn(BLOCK_HEADING, 'text-3xl focus:outline-none')}>
        Lezione finita
      </h2>
      <p className="text-lg tabular-nums">
        {fine.giuste} {fine.giuste === 1 ? 'giusta' : 'giuste'} su {fine.totale}
      </p>
      {gain ? (
        <p className={cn('inline-flex items-center rounded-full px-4 py-2 text-base font-semibold', INK_BG, 'text-white dark:text-slate-950')}>
          <span aria-hidden>{gainLabel(gain)}</span>
          <span className="sr-only">{gainSentence(gain)}</span>
        </p>
      ) : (
        <p className={MUTED_TEXT}>Per oggi le lezioni non danno più punti.</p>
      )}
      <p className={cn('text-sm', MUTED_TEXT)}>Sei al livello {fine.xp.livello.livello}.</p>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button type="button" onClick={onAgain} className={INK_BUTTON}>
          Un’altra lezione
        </button>
        <Link to={HOME} className={cn(SECONDARY_BUTTON, 'inline-flex items-center justify-center')}>
          Torna a Oggi
        </Link>
      </div>
    </section>
  );
}

type Load = { status: 'loading' } | { status: 'error'; detail: string | null } | { status: 'ready'; lesson: Lezione };

/**
 * The short lesson (LC63), a screen of its own in `LessonFrame`: the server builds 5–8 exercises from the subject's
 * cards, one is shown at a time under a progress bar, each answer goes to the server, which grades it and gives the
 * key, and the correction is said at once. The last answer brings the end: the right answers and the XP the server
 * credited, or that it credited none. Esc and the cross go back to «Oggi».
 */
export function LessonSession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const raw = params.get('materia');
  const materia = isMateria(raw) ? raw : null;
  const [round, setRound] = useState(0);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [chosen, setChosen] = useState<RispostaEsercizio | null>(null);
  const [graded, setGraded] = useState<EsitoEsercizio | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [fine, setFine] = useState<EsitoEsercizio['fine'] | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (materia === null) return;
    let live = true;
    studiaService.createLesson(materia).then(
      (lesson) => live && setLoad({ status: 'ready', lesson }),
      (error: unknown) => live && setLoad({ status: 'error', detail: refusal(error) }),
    );
    return () => {
      live = false;
    };
  }, [materia, round]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Esc in the match's select closes its list, not the lesson.
      if (event.key === 'Escape' && !(event.target instanceof HTMLSelectElement)) navigate(HOME);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  useEffect(() => {
    if (graded) continueRef.current?.focus();
  }, [graded]);

  const lesson = load.status === 'ready' ? load.lesson : null;
  const total = lesson?.esercizi.length ?? 0;

  const send = useCallback(
    (value: RispostaEsercizio) => {
      if (!lesson) return;
      setChosen(value);
      setBusy(true);
      setSendFailed(false);
      studiaService.answerLesson(lesson.id, index, value).then(
        (result) => {
          setGraded(result);
          setAnswered((n) => n + 1);
          if (result.fine) setFine(result.fine);
          setBusy(false);
        },
        () => {
          setSendFailed(true);
          setBusy(false);
        },
      );
    },
    [lesson, index],
  );

  const next = () => {
    setGraded(null);
    setChosen(null);
    setIndex((i) => i + 1);
  };

  /** A new lesson: the screen says it is preparing one until the server answers. */
  const reload = () => {
    setLoad({ status: 'loading' });
    setRound((r) => r + 1);
  };

  const again = () => {
    setIndex(0);
    setAnswered(0);
    setGraded(null);
    setChosen(null);
    setFine(null);
    reload();
  };

  const showEnd = fine !== null && graded === null;
  const exercise = lesson && !showEnd ? lesson.esercizi[index] : null;

  let body;
  if (materia === null) {
    body = <Notice text="Materia non riconosciuta." />;
  } else if (load.status === 'loading') {
    body = <p className={MUTED_TEXT}>Preparo la lezione…</p>;
  } else if (load.status === 'error') {
    body = <Notice text={load.detail ?? 'Non riesco a preparare la lezione.'} onRetry={load.detail ? undefined : reload} />;
  } else if (showEnd && fine) {
    body = <EndScreen fine={fine} onAgain={again} />;
  } else if (exercise) {
    body = (
      <div className="grid grid-cols-1 gap-6">
        <Exercise key={index} exercise={exercise} graded={graded} chosen={chosen} busy={busy} onAnswer={send} />
        {sendFailed && (
          <div className="grid gap-1">
            <p className="text-sm text-red-700 dark:text-red-400">Non riesco a inviare la risposta.</p>
            <button type="button" onClick={() => chosen !== null && send(chosen)} className={cn(SECONDARY_BUTTON, 'justify-self-start')}>
              Riprova
            </button>
          </div>
        )}
        {graded && (
          <div className={cn('grid gap-3 rounded-2xl px-4 py-4', graded.giusta ? 'bg-green-50 dark:bg-green-950/40' : 'bg-red-50 dark:bg-red-950/40')}>
            <p id="lezione-correzione" role="status" className={cn('text-base font-semibold', graded.giusta ? SUCCESS_TEXT : 'text-red-700 dark:text-red-400')}>
              {graded.giusta ? 'Giusto!' : `Non è così. La risposta giusta: ${sentence(solutionWords(exercise, graded.soluzione))}`}
            </p>
            <button ref={continueRef} type="button" onClick={next} aria-describedby="lezione-correzione" className={cn(INK_BUTTON, 'w-full sm:w-auto sm:justify-self-end')}>
              Continua
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => navigate(HOME)}
          aria-label="Chiudi la lezione"
          className={cn('inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING)}
        >
          <X size={20} aria-hidden />
        </button>
        <div
          role="progressbar"
          aria-label="Avanzamento della lezione"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
          className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        >
          <div className={cn('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300', INK_BG)} style={{ width: total ? `${(answered / total) * 100}%` : '0%' }} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {materia && <p className={cn('mb-4 text-sm', MUTED_TEXT)}>Lezione breve · {MATERIA_LABEL[materia]}</p>}
          {body}
        </div>
      </div>
    </div>
  );
}

function Notice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="grid grid-cols-1 justify-items-start gap-3">
      <p className="max-w-prose text-base">{text}</p>
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className={INK_BUTTON}>
            Riprova
          </button>
        )}
        <Link to={HOME} className={cn(SECONDARY_BUTTON, 'inline-flex items-center justify-center')}>
          Torna a Oggi
        </Link>
      </div>
    </div>
  );
}
