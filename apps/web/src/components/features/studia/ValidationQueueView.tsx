import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import type { Materia, Scheda } from '../../../types/studia';
import { FormSelect } from '../../ui/FormSelect';
import { Toast } from '../../ui/Toast';
import { ArticleReadOnly } from './ArticleReadOnly';
import { MATERIA_LABEL, anchorLabel, cardTitle, normaFromAnchor } from './studiaLabels';
import { useValidationQueue, type VoteOutcome } from './useValidationQueue';
import { VoteBar } from './VoteBar';
import { recordXpSeen } from './progress/seenProgress';
import { gainOf, gainWords } from './progress/xpGains';
import type { StudiaOutletContext } from './StudiaPage';
import { BLOCK_HEADING, FOCUS_RING, INK_TEXT, MUTED_TEXT, TILE } from './progress/tokens';

const STORAGE_KEY = 'visualex.studia.valida.materia';
const MEASURE = 'max-w-[60ch]';
const PART_HEADING = 'mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200';
/** A state of the queue with nothing to judge: a tile, its sentence in the reader's serif. */
const STATE_TILE = cn(TILE, 'space-y-1 p-5 md:p-6');
const STATE_LINE = cn('font-serif text-xl leading-snug', INK_TEXT);
const MATERIE = Object.keys(MATERIA_LABEL) as Materia[];

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

/** The subject the validator last chose; a missing, unreadable or unknown value is «all subjects». */
function rememberedMateria(): Materia | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MATERIE.find((materia) => materia === stored);
  } catch {
    return undefined;
  }
}

function rememberMateria(materia: Materia | undefined): void {
  try {
    if (materia) localStorage.setItem(STORAGE_KEY, materia);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or a full store: the choice lasts for this visit only.
  }
}

const OUTCOME_TOAST: Partial<Record<VoteOutcome, Exclude<ToastState, null>>> = {
  voted: { message: 'Voto registrato', type: 'success' },
  gone: { message: 'La scheda non è più in coda: passo alla prossima.', type: 'info' },
  already: { message: 'Hai già votato questa scheda: passo alla prossima.', type: 'info' },
  failed: { message: 'Non sono riuscito a registrare il voto. Riprova.', type: 'error' },
};

/**
 * The card under review, read like the law it rests on: the title as a source line, then the
 * question and the answer in the reader's serif, set apart by one rule. Everything is plain text.
 */
function CardBody({ card, headingRef }: { card: Scheda; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const anchors = [...card.ancore].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const others = anchors.slice(1);
  return (
    <article aria-label="Scheda da validare" className={cn(TILE, 'space-y-5 p-5 md:p-6')}>
      <div>
        {/* Focusable by script only: after a vote the keyboard lands here, on the card that comes next. */}
        <h3 ref={headingRef} tabIndex={-1} className={cn('mb-2 break-words text-sm focus:outline-none', MUTED_TEXT)}>{cardTitle(card)}</h3>
        <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-xl leading-[1.7] text-slate-900 dark:text-slate-50')}>{card.domanda}</p>
        <hr className={cn(MEASURE, 'my-4 border-slate-200 dark:border-slate-700')} />
        <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-lg leading-[1.7] text-slate-800 dark:text-slate-200')}>{card.risposta}</p>
      </div>
      {card.spiegazione && (
        <section>
          <h4 className={PART_HEADING}>Spiegazione</h4>
          <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-base leading-[1.7] text-slate-600 dark:text-slate-400')}>{card.spiegazione}</p>
        </section>
      )}
      {others.length > 0 && (
        <section>
          <h4 className={PART_HEADING}>Altre ancore</h4>
          <ul className="space-y-1 break-words text-sm text-slate-700 dark:text-slate-200">
            {others.map((anchor) => (
              <li key={`${anchor.normaKey}|${anchor.articleId}`}>{anchorLabel(anchor) ?? anchor.urn}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/**
 * The article the card rests on: the primary anchor's, read from the address the anchor holds. When
 * the address cannot be turned back into an article, the citation stands alone with a short note.
 */
function AnchoredArticle({ card, showToast }: { card: Scheda; showToast: (message: string, type?: 'success' | 'error' | 'info') => void }) {
  const anchor = card.ancore.find((a) => a.isPrimary) ?? card.ancore[0];
  const urn = anchor?.urn;
  const norma = useMemo(() => (urn ? normaFromAnchor({ urn }) : null), [urn]);
  if (!anchor || !norma) {
    return (
      <div className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
        {anchor && <p className="break-words">{anchorLabel(anchor) ?? anchor.urn}</p>}
        <p className={MUTED_TEXT}>Il testo di questo articolo non si può aprire qui.</p>
      </div>
    );
  }
  return <ArticleReadOnly key={`${card.id}|${urn}`} norma={norma} showToast={showToast} />;
}

/**
 * «Da validare»: the proposed cards a validator may judge, one at a time, oldest first, with the
 * article the card rests on beside it (under it, collapsed, on a phone) and the three verdicts at
 * the bottom. The subject filter is remembered in the browser and starts the next visit.
 */
export function ValidationQueueView() {
  const desktop = useIsDesktop();
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  // What the account says (undefined while it loads, null when it could not be read: then the server
  // decides); outside the area's outlet the server decides too.
  const outlet = useOutletContext<StudiaOutletContext | undefined>();
  const validator = outlet ? outlet.validator : true;
  const { status, card, voting, vote, retry } = useValidationQueue(materia, validator);
  // A refusal reads «no longer» unless the account says the person never was a validator, or could
  // not say (as before the account was asked, when a failed read counted as «not a validator»).
  const neverValidator = validator === false || validator === null;
  const [toast, setToast] = useState<ToastState>(null);
  // The collapsed section belongs to a card: the next one starts closed.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => setToast({ message, type });
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The card a vote was cast on, until the next card is on screen: only then does the keyboard move.
  const votedOn = useRef<string | null>(null);

  const cardId = card?.id;
  useEffect(() => {
    if (!cardId || !votedOn.current || votedOn.current === cardId) return;
    votedOn.current = null;
    headingRef.current?.focus();
  }, [cardId]);

  const chooseMateria = (value: string) => {
    votedOn.current = null;
    const next = MATERIE.find((m) => m === value);
    setMateria(next);
    rememberMateria(next);
  };

  const cast: Parameters<typeof VoteBar>[0]['onVote'] = async (giudizio, motivazione) => {
    votedOn.current = card?.id ?? null;
    const { outcome, xp } = await vote(giudizio, motivazione);
    // The card stays (the vote failed, or the user was stopped): the keyboard stays where it is.
    if (outcome === 'failed' || outcome === 'forbidden') votedOn.current = null;
    const message = OUTCOME_TOAST[outcome];
    // The points ride on the vote's message (G1c), saying who earns them: «Voto registrato · hai guadagnato 20 punti».
    // Never a word that reads as what the vote weighs or gave the card (G-318).
    const gain = gainOf(Date.now(), xp);
    if (xp) recordXpSeen(xp);
    if (message) setToast(gain ? { ...message, message: `${message.message} · ${gainWords(gain)}` } : message);
  };

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={BLOCK_HEADING}>Da validare</h2>
        <div className="w-full md:w-64">
          <FormSelect aria-label="Materia" value={materia ?? ''} onChange={(e) => chooseMateria(e.target.value)} className="min-h-[44px] rounded-xl">
            <option value="">Tutte le materie</option>
            {MATERIE.map((m) => (
              <option key={m} value={m}>{MATERIA_LABEL[m]}</option>
            ))}
          </FormSelect>
        </div>
      </header>

      {status === 'loading' && <p className={cn('text-sm', MUTED_TEXT)}>Carico le schede…</p>}
      {status === 'empty' && (
        <div className={STATE_TILE}>
          <p className={STATE_LINE}>{materia ? 'Nessuna scheda da validare in questa materia' : 'Nessuna scheda da validare'}</p>
        </div>
      )}
      {status === 'forbidden' && (
        <div role="alert" className={cn(STATE_TILE, 'text-sm text-slate-700 dark:text-slate-200')}>
          <p className={STATE_LINE}>{neverValidator ? 'Questa sezione è riservata ai validatori di VisuaLex Gymnasium' : 'Non sei più tra i validatori'}</p>
          <p>Se pensi sia un errore, chiedilo a un amministratore.</p>
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 py-4 text-sm text-red-700 dark:text-red-400">
          Non riesco a leggere le schede da validare.
          <button type="button" onClick={() => {
              votedOn.current = null;
              retry();
            }}
            className={cn('min-h-[44px] rounded px-1 font-medium underline', FOCUS_RING)}>
            Riprova
          </button>
        </div>
      )}

      {status === 'ready' && card && (
        <>
          <div className="md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-6">
            <div className="min-w-0">
              <CardBody card={card} headingRef={headingRef} />
              {!desktop && (
                <section className="mt-5 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <h4>
                    <button
                      type="button"
                      aria-expanded={openFor === card.id}
                      onClick={() => setOpenFor(openFor === card.id ? null : card.id)}
                      className={cn('flex min-h-[44px] w-full items-center justify-between rounded text-left text-sm font-semibold text-slate-700 dark:text-slate-200', FOCUS_RING)}
                    >
                      Testo dell’articolo
                      <ChevronDown size={16} aria-hidden className={cn('transition-transform motion-reduce:transition-none', openFor === card.id && 'rotate-180')} />
                    </button>
                  </h4>
                  {openFor === card.id && <AnchoredArticle card={card} showToast={showToast} />}
                </section>
              )}
            </div>
            {desktop && (
              // Scrolls on its own, and is cut to what is left under the page's heading, the area's strip, the heading with the filter and the vote bar (about 22rem);
              // below lg it pins under the phone's bar (M1).
              <div className={cn(TILE, 'sticky top-[var(--phone-bar-offset,0px)] transition-[top] duration-200 ease-out motion-reduce:transition-none max-h-[calc(100dvh-22rem)] min-w-0 overflow-y-auto p-4')}>
                <AnchoredArticle card={card} showToast={showToast} />
              </div>
            )}
          </div>
          {/* Pinned to the bottom of the screen at every width, so a long card or a tall article never pushes it out of reach. */}
          <div
            className={cn(
              'sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-50 px-4 py-3 md:-mx-2 md:px-2 dark:border-slate-800 dark:bg-slate-950',
              Z_INDEX.sticky,
            )}
          >
            <VoteBar cardId={card.id} busy={voting} onVote={(giudizio, motivazione) => void cast(giudizio, motivazione)} />
          </div>
        </>
      )}

      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        <Toast message={toast?.message ?? ''} type={toast?.type ?? 'success'} isVisible={toast !== null} onClose={() => setToast(null)} />
      </div>
    </section>
  );
}
