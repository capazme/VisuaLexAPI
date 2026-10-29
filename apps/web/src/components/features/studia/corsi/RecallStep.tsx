import { useId, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { FIELD_TEXT } from '../../../../constants/interactions';
import type { BloccoLezione, Chiave, DomandaModulo } from '../../../../types/corsi';
import { BLOCK_HEADING, FOCUS_RING, INK_BUTTON, MUTED_TEXT, SUCCESS_TEXT, TILE } from '../progress/tokens';
import { LessonText } from './LessonText';
import type { Span } from './lessonFormat';

/** The recall of a block (§5, step 4): first written with the text hidden, then compared beside it, then its questions. */
export type FaseRichiamo = 'scrivi' | 'confronta' | 'domande';

/** The trace of the free recall (§5, step 4). */
export const RECALL_TRACE = 'Senza guardare il testo, scrivi quello che ricordi: gli elementi, le eccezioni, un caso.';

interface RecallStepProps {
  blocco: BloccoLezione;
  /** «Blocco 2 di 4». */
  where: string;
  fase: FaseRichiamo;
  scritto: string;
  onScritto: (value: string) => void;
  spans: readonly Span[];
  onSpans: (spans: Span[]) => void;
  citations: ReadonlyMap<string, string>;
  onCite: (marker: string, opener: HTMLElement) => void;
  onAnswer: (domandaId: string, scelta: Chiave) => Promise<void>;
  headingRef: (el: HTMLHeadingElement | null) => void;
}

/**
 * A block's recall, its phases chosen by the session's bar: «scrivi» (the trace and a free text, the block hidden — the
 * text never leaves the browser, §8), «confronta» (what was written beside the block, on a phone above it), «domande»
 * (the block's 0–3 recall questions, graded by the server).
 */
export function RecallStep({ blocco, where, fase, scritto, onScritto, spans, onSpans, citations, onCite, onAnswer, headingRef }: RecallStepProps) {
  const fieldId = useId();
  const title = blocco.titolo ?? where;
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 gap-1">
        <p className={cn('text-sm font-medium', MUTED_TEXT)}>{where} · Richiamo</p>
        <h1 ref={headingRef} tabIndex={-1} className="break-words font-serif text-2xl font-medium tracking-tight text-slate-900 focus:outline-none md:text-3xl dark:text-slate-50">
          {fase === 'domande' ? `Domande su «${title}»` : `Che cosa ricordi di «${title}»?`}
        </h1>
      </div>

      {fase === 'scrivi' && (
        <div className="grid grid-cols-1 gap-2">
          <label htmlFor={fieldId} className="max-w-[65ch] text-base leading-relaxed text-slate-800 dark:text-slate-200">
            {RECALL_TRACE}
          </label>
          <textarea
            id={fieldId}
            value={scritto}
            onChange={(event) => onScritto(event.target.value)}
            rows={10}
            className={cn(
              'min-h-[44px] w-full max-w-[65ch] resize-y rounded-xl border border-slate-300 bg-white p-3 leading-relaxed text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
              FIELD_TEXT,
              FOCUS_RING,
            )}
          />
          <p className={cn('text-sm', MUTED_TEXT)}>Resta su questo dispositivo: non viene inviato e si perde quando chiudi il modulo.</p>
        </div>
      )}

      {fase === 'confronta' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section aria-labelledby={`${fieldId}-scritto`} className={cn(TILE, 'grid content-start gap-2 p-4')}>
            <h2 id={`${fieldId}-scritto`} className={BLOCK_HEADING}>
              Quello che hai scritto
            </h2>
            {scritto.trim() === '' ? (
              <p className={cn('text-sm', MUTED_TEXT)}>Non hai scritto nulla: confronta lo stesso, e la prossima volta prova a scrivere prima.</p>
            ) : (
              <p className="whitespace-pre-wrap break-words font-serif text-base leading-relaxed text-slate-900 dark:text-slate-100">{scritto}</p>
            )}
          </section>
          <section aria-labelledby={`${fieldId}-testo`} className="grid content-start gap-2">
            <h2 id={`${fieldId}-testo`} className={BLOCK_HEADING}>
              Il testo
            </h2>
            <LessonText text={blocco.testo} spans={spans} onSpans={onSpans} citations={citations} onCite={onCite} />
          </section>
        </div>
      )}

      {fase === 'domande' && (
        <ol className="grid grid-cols-1 gap-6">
          {blocco.richiamo.map((domanda, i) => (
            <li key={domanda.id}>
              <RecallQuestion domanda={domanda} numero={i + 1} totale={blocco.richiamo.length} onAnswer={(scelta) => onAnswer(domanda.id, scelta)} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

interface RecallQuestionProps {
  domanda: DomandaModulo;
  numero: number;
  totale: number;
  /** Sends the choice; rejects when it was not recorded, its message what follows «Non registrato: » («riprova.»). */
  onAnswer: (scelta: Chiave) => Promise<void>;
}

/** «la b», «l’a», «l’e», «l’f»: the key as it is read aloud. */
const theKey = (chiave: Chiave) => (['a', 'e', 'f'].includes(chiave) ? `l’${chiave}` : `la ${chiave}`);

/**
 * One recall question: real radio buttons in a fieldset, «Rispondi», and — once the server graded it — every option's
 * explanation, the right one and the reader's marked in words and by shape, the outcome said in a live region. The web
 * never decides «right» or «wrong» (§4): it shows what the server answered. A choice that did not arrive keeps the
 * choice and says «Non registrato: riprova».
 */
export function RecallQuestion({ domanda, numero, totale, onAnswer }: RecallQuestionProps) {
  const name = useId();
  const [scelta, setScelta] = useState<Chiave | null>(domanda.risposta?.scelta ?? null);
  const [sending, setSending] = useState(false);
  // «Rispondi» goes once the answer is graded: the focus moves to the question, not to the page's body, so Tab goes on
  // from here and a screen reader keeps its place (the outcome itself is read by the live region).
  const fieldset = useRef<HTMLFieldSetElement>(null);
  /** Why the last choice was not recorded, after «Non registrato: »; null when nothing failed. */
  const [failed, setFailed] = useState<string | null>(null);
  const risposta = domanda.risposta;
  const answered = risposta !== null;
  const shown = risposta?.scelta ?? scelta;

  const send = async () => {
    if (!scelta || sending || answered) return;
    setSending(true);
    setFailed(null);
    try {
      await onAnswer(scelta);
      requestAnimationFrame(() => fieldset.current?.focus({ preventScroll: true }));
    } catch (error) {
      setFailed(error instanceof Error && error.message ? error.message : 'riprova.');
    } finally {
      setSending(false);
    }
  };

  return (
    <fieldset ref={fieldset} tabIndex={-1} className={cn(TILE, 'grid min-w-0 grid-cols-1 gap-3 p-4 focus:outline-none md:p-5')}>
      <legend className="sr-only">
        Domanda {numero} di {totale}: {domanda.testo}
      </legend>
      <p aria-hidden className="break-words font-serif text-lg leading-snug text-slate-900 dark:text-slate-50">
        <span className={cn('mr-2 font-sans text-sm font-semibold', MUTED_TEXT)}>
          {numero} di {totale}
        </span>
        {domanda.testo}
      </p>
      <div className="grid grid-cols-1 gap-2">
        {domanda.opzioni.map((opzione) => {
          const right = risposta?.corretta === opzione.chiave;
          const mine = risposta?.scelta === opzione.chiave;
          return (
            <label
              key={opzione.chiave}
              className={cn(
                'grid min-h-[44px] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-xl border p-3 text-base',
                answered ? 'cursor-default' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                right
                  ? 'border-green-700 bg-green-50 dark:border-green-500 dark:bg-green-950/30'
                  : mine
                    ? 'border-amber-600 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/30'
                    : 'border-slate-200 dark:border-slate-700',
              )}
            >
              <input
                type="radio"
                name={name}
                value={opzione.chiave}
                checked={shown === opzione.chiave}
                disabled={answered || sending}
                onChange={() => setScelta(opzione.chiave)}
                className={cn('mt-1 h-5 w-5 accent-primary-800 dark:accent-primary-300', FOCUS_RING)}
              />
              <span className="min-w-0 break-words text-slate-900 dark:text-slate-100">
                <span className={cn('mr-1 font-semibold', MUTED_TEXT)}>{opzione.chiave})</span>
                {opzione.testo}
              </span>
              {answered && (
                <span className="col-start-2 grid min-w-0 gap-1 text-sm leading-relaxed">
                  {(right || mine) && (
                    <span className={cn('inline-flex items-center gap-1 font-semibold', right ? SUCCESS_TEXT : 'text-amber-800 dark:text-amber-300')}>
                      {right ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
                      {right && mine ? 'La tua risposta, giusta' : right ? 'La risposta giusta' : 'La tua risposta'}
                    </span>
                  )}
                  {opzione.spiegazione && <span className="break-words text-slate-700 dark:text-slate-300">{opzione.spiegazione}</span>}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {/* The outcome, said once it arrives (a question already answered when the page opens is not read out). */}
      <p aria-live="polite" className={cn('text-sm font-semibold', risposta?.corretto ? SUCCESS_TEXT : 'text-amber-800 dark:text-amber-300')}>
        {risposta ? (risposta.corretto ? 'Giusto.' : `Non è giusto: la risposta giusta è ${theKey(risposta.corretta)}.`) : ''}
      </p>
      {!answered && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void send()} disabled={!scelta || sending} aria-busy={sending || undefined} className={INK_BUTTON}>
            {failed !== null ? 'Riprova' : 'Rispondi'}
          </button>
          {failed !== null && (
            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
              Non registrato: {failed}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
