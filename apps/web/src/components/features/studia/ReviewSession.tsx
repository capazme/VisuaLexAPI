import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { useAppStore } from '../../../store/useAppStore';
import type { AncoraScheda, Materia, Progressi } from '../../../types/studia';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Toast } from '../../ui/Toast';
import { DossierItemReader } from '../dossier/DossierItemReader';
import { formatInterval } from './formatInterval';
import { GradeBar, LessonBar } from './GradeBar';
import { LESSON_PRIMARY } from './lessonStyles';
import { ReviewCard } from './ReviewCard';
import { Sheet } from '../../ui/Sheet';
import { MATERIA_LABEL, anchorLabel, normaFromAnchor, searchParamsFromAnchor } from './studiaLabels';
import { SessionCelebration } from './progress/Celebration';
import { XpGain } from './progress/XpGain';
import { SessionEndProgress } from './progress/SessionEndProgress';
import { cardsLeft, instituteCardsLeft } from './progress/today';
import { usePercorso } from './progress/usePercorso';
import { FOCUS_RING, QUIET_BUTTON, TILE } from './progress/tokens';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { useProgress } from './progress/useProgress';
import { useGradeNote } from './useGradeNote';
import { useReviewSession, type ReviewSummary } from './useReviewSession';

const HOME_PATH = '/studia/ripasso';

/** The lesson's column: the card and the header's row share its width (the bar's actions sit in a narrower one). */
const COLUMN = 'mx-auto w-full max-w-3xl';

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

const schede = (n: number) => (n === 1 ? '1 scheda' : `${n} schede`);

/** «Hai ripassato 23 schede, 4 da rifare. Le prossime: domani.» */
function endSentence({ reviewed, again, nextDue }: ReviewSummary): string {
  if (reviewed === 0) return 'Nessuna scheda da ripassare per ora.';
  const redo = again === 0 ? 'nessuna da rifare' : `${again} da rifare`;
  const next = nextDue === null ? '' : ` Le prossime: ${formatInterval(nextDue)}.`;
  return `Hai ripassato ${schede(reviewed)}, ${redo}.${next}`;
}

/** The bar's tremble when the ink arrives: a pixel down and back, as the ink settles (under 400 ms in all). */
const PLUCK: Keyframe[] = [{ translate: '0 0' }, { translate: '0 1px' }, { translate: '0 -0.5px' }, { translate: '0 0' }];

/**
 * The lesson's progress (Gymnasium spec §5.4): `done / (done + remaining)`, where done are the cards out of the
 * queue — a «Di nuovo» stays in it, so the bar holds still and the note says «Torna in coda». At each grade that
 * moves it the head runs ahead in the section's hue, the ink catches up a moment later on a spring and the bar
 * trembles by a pixel (S2; inspired by Animorio's «I passi con la linea che avanza», written from scratch): 370 ms,
 * taking no key and no focus. Under reduced motion it jumps (`motion-safe:` only, no tremble). Before the queue is
 * read it is an empty track.
 */
function LessonProgress({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? done / total : 0;
  const track = useRef<HTMLDivElement>(null);
  const lastDone = useRef(done);
  useEffect(() => {
    const grew = done > lastDone.current;
    lastDone.current = done;
    const el = track.current;
    if (!grew || !el || typeof el.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(PLUCK, { duration: 110, delay: 260, easing: 'ease-out' });
  }, [done]);
  const width = { width: `${share * 100}%` };
  return (
    <div
      ref={track}
      {...(total > 0
        ? { role: 'progressbar', 'aria-label': 'Avanzamento del ripasso', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done, 'aria-valuetext': `${done} di ${schede(total)}` }
        : { 'aria-hidden': true })}
      className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
    >
      <div aria-hidden className="vlx-lesson-head absolute inset-y-0 left-0 rounded-full motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out" style={width} />
      <div
        data-testid="lesson-progress-fill"
        className={cn(
          // The section's hue, not the ink's near-grey (G8): `vlx-lesson-ink` in `index.css`.
          'vlx-lesson-ink absolute inset-y-0 left-0 rounded-full motion-safe:transition-[width] motion-safe:delay-[70ms] motion-safe:duration-300 motion-safe:ease-(--ease-catch)',
        )}
        style={width}
      />
    </div>
  );
}

interface ArticlePanelProps {
  anchor: AncoraScheda;
  desktop: boolean;
  onClose: () => void;
  onOpenInReader: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** The article an anchor rests on, read as the dossier embeds it: beside the card on desktop, in a sheet on a phone. */
function ArticlePanel({ anchor, desktop, onClose, onOpenInReader, showToast }: ArticlePanelProps) {
  const norma = useMemo(() => normaFromAnchor(anchor), [anchor]);
  const label = anchorLabel(anchor) ?? 'Articolo';
  if (!norma) return null;
  const reader = <DossierItemReader norma={norma} onOpenOnDashboard={onOpenInReader} showToast={showToast} />;

  if (!desktop) {
    return (
      <Sheet title={label} onClose={onClose} closeOnEscape>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{reader}</div>
      </Sheet>
    );
  }
  // Beside the card, as tall as the lesson's middle, scrolling on its own.
  return (
    <aside
      aria-label="Articolo"
      className="w-[min(28rem,45%)] min-w-0 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi l’articolo"
          className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200', FOCUS_RING)}
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      {reader}
    </aside>
  );
}

interface SessionEndProps {
  summary: ReviewSummary;
  materia: Materia | undefined;
  /** One institute of `materia` (G5): what is left is counted in it, not in the whole subject. */
  istituto: string | undefined;
  onHome: () => void;
  onContinue: () => void;
}

/**
 * The lesson's end (Gymnasium spec §5.4): the sentence, the ring and the streak as they now stand, and in the bar
 * «Torna a Oggi» and — when the read of the session's scope still counts cards for today — «Continua», a new
 * session of the same scope. The scope is the day, the subject, or one institute of it (G5), whose count comes from
 * the road's read (`usePercorso`). Focus goes to the sentence, so a screen reader hears how it went.
 */
function SessionEnd({ summary, materia, istituto, onHome, onContinue }: SessionEndProps) {
  const day = useProgress(undefined);
  const subject = useProgress(materia, materia !== undefined);
  const dayData = day.status === 'ready' ? day.data : null;
  if (materia !== undefined && istituto !== undefined) {
    return <InstituteEnd summary={summary} materia={materia} istituto={istituto} subject={subject.status === 'ready' ? subject.data : null} day={dayData} onHome={onHome} onContinue={onContinue} />;
  }
  const scope = materia === undefined ? day : subject;
  const more = scope.status === 'ready' && cardsLeft(scope.data) > 0;
  return <EndScreen summary={summary} day={dayData} more={more} onHome={onHome} onContinue={onContinue} />;
}

interface InstituteEndProps {
  summary: ReviewSummary;
  materia: Materia;
  istituto: string;
  subject: Progressi | null;
  day: Progressi | null;
  onHome: () => void;
  onContinue: () => void;
}

/** The end of a session narrowed to one institute: «Continua» from the institute's own count. */
function InstituteEnd({ summary, materia, istituto, subject, day, onHome, onContinue }: InstituteEndProps) {
  const percorso = usePercorso();
  const more = percorso.status === 'ready' && subject !== null && instituteCardsLeft(percorso.data, materia, istituto, subject) > 0;
  return <EndScreen summary={summary} day={day} more={more} onHome={onHome} onContinue={onContinue} />;
}

interface EndScreenProps {
  summary: ReviewSummary;
  day: Progressi | null;
  more: boolean;
  onHome: () => void;
  onContinue: () => void;
}

function EndScreen({ summary, day, more, onHome, onContinue }: EndScreenProps) {
  const sentence = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    sentence.current?.focus({ preventScroll: true });
  }, []);

  // One card, centred, with one primary action (G8): «Continua» while the scope still has cards today, else «Torna a
  // Oggi»; with «Continua», «Torna a Oggi» is a quiet link under it, never a second button alike.
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn(COLUMN, 'grid px-4 py-8 md:py-14')}>
        <section data-testid="lesson-end" aria-label="Fine del ripasso" className={cn(TILE, 'mx-auto grid w-full max-w-xl justify-items-center gap-6 p-6 text-center md:p-8')}>
          <p ref={sentence} tabIndex={-1} className="max-w-[60ch] font-serif text-2xl leading-snug text-slate-900 focus:outline-none md:text-3xl dark:text-slate-50">
            {endSentence(summary)}
          </p>
          <SessionEndProgress data={day} />
          <div className="grid w-full justify-items-center gap-1 md:w-auto">
            <button type="button" onClick={more ? onContinue : onHome} className={cn(LESSON_PRIMARY, 'md:min-w-64')}>
              {more ? 'Continua' : 'Torna a Oggi'}
            </button>
            {more && (
              <button type="button" onClick={onHome} className={cn(QUIET_BUTTON, 'mx-0 justify-self-center text-center')}>
                Torna a Oggi
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * A review session (`/studia/ripasso/sessione?materia=&istituto=`), drawn as the lesson (Gymnasium spec §5.4): at the top the
 * close button and the progress bar, in the middle the card, at the foot the bar with the one action available. The
 * queue lives in `useReviewSession`, so opening and closing an anchor's article leaves it as it was. While a card is
 * on screen, closing (the button or Esc) asks before leaving — what was graded is already recorded; with no card
 * (the end, a failed read, the read on its way) there is nothing to interrupt, and it goes back to Oggi. `StudiaPage`
 * draws it in `LessonFrame`, over the shell.
 */
export function ReviewSession() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const triggerSearch = useAppStore((s) => s.triggerSearch);

  const requested = params.get('materia');
  const materia = requested && Object.keys(MATERIA_LABEL).includes(requested) ? (requested as Materia) : undefined;
  // An institute only within a subject (the server refuses one alone), passed back as the road spelt it.
  const istituto = (materia && params.get('istituto')) || undefined;

  const [confirmStop, setConfirmStop] = useState(false);
  const [panel, setPanel] = useState<{ step: number; anchor: AncoraScheda } | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  // Esc closes the article beside the card first (on a phone the sheet closes itself); a second one asks to stop,
  // or leaves when there is no card to interrupt.
  const panelOpen = useRef(false);
  const cardOnScreen = useRef(false);
  const handleEscape = useCallback(() => {
    if (panelOpen.current) setPanel(null);
    else if (cardOnScreen.current) setConfirmStop(true);
    else navigate(HOME_PATH);
  }, [navigate]);

  const { current, revealed, reveal, grade, remaining, done, summary, practice, step, loading, loadError, saveError, skipped, saving, reload, goalMet, xpGain } =
    useReviewSession(materia, { istituto, paused: confirmStop, onEscape: handleEscape });
  const { note, noteKey, recordGrade } = useGradeNote({ step, current, revealed, practice, saving, skipped, paused: confirmStop });
  // The grade that made the day count plays the celebration, once a day for this browser (spec decision 10).
  const { celebratedBefore, markCelebrated } = useCelebratedToday();
  // The day whose notice has run its course here: the notice goes, and a later closing grade (the goal raised) does not bring it back.
  const [noticeDone, setNoticeDone] = useState<string | null>(null);
  const celebrating = goalMet !== null && !celebratedBefore(goalMet.giorno) && noticeDone !== goalMet.giorno;

  // The queue as it was read: it only shrinks (a «Di nuovo» goes to the back), so its largest length since the
  // read is the lesson's total. A new read (Riprova, Continua) starts it again.
  const [total, setTotal] = useState(0);
  if (loading && total !== 0) setTotal(0);
  else if (!loading && remaining > total) setTotal(remaining);

  const showCard = !loadError && !loading && !done && current !== null;
  // An article belongs to the step it was opened at: a card that comes back is a new step.
  const openAnchor = panel && current && panel.step === step ? panel.anchor : null;
  // In the commit, not after it: an Esc pressed as soon as a card is drawn must already find it there, or it would
  // leave without asking.
  useLayoutEffect(() => {
    panelOpen.current = openAnchor !== null && desktop;
    cardOnScreen.current = showCard;
  }, [openAnchor, desktop, showCard]);

  const openInReader = (anchor: AncoraScheda) => {
    const searchParams = searchParamsFromAnchor(anchor);
    if (!searchParams) return;
    navigate('/');
    triggerSearch(searchParams);
  };

  const leave = () => (showCard ? setConfirmStop(true) : navigate(HOME_PATH));

  const skippedLine = skipped && (
    <p role="status" className="mb-4 text-sm text-slate-600 dark:text-slate-300">
      Questa scheda non è più da ripassare.
    </p>
  );

  let middle;
  if (loadError) {
    middle = (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(COLUMN, 'px-4 py-8')}>
            <p role="alert" className="font-serif text-xl leading-snug text-red-700 dark:text-red-400">
              Non riesco a leggere le schede da ripassare.
            </p>
          </div>
        </div>
        <LessonBar>
          <button type="button" onClick={() => void reload()} className={LESSON_PRIMARY}>
            Riprova
          </button>
        </LessonBar>
      </>
    );
  } else if (loading) {
    middle = (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(COLUMN, 'px-4 py-6')}>
            <p className="sr-only">Carico le schede…</p>
            <div aria-hidden className="h-56 rounded-2xl border border-slate-200 bg-white motion-safe:animate-pulse dark:border-slate-800 dark:bg-slate-900" />
          </div>
        </div>
        <LessonBar>
          <div aria-hidden className="h-12 rounded-xl bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
        </LessonBar>
      </>
    );
  } else if (!showCard) {
    middle = (
      <>
        {skipped && <div className={cn(COLUMN, 'px-4 pt-4')}>{skippedLine}</div>}
        <SessionEnd summary={summary} materia={materia} istituto={istituto} onHome={() => navigate(HOME_PATH)} onContinue={() => void reload()} />
      </>
    );
  } else {
    middle = (
      <>
        <div className="flex min-h-0 flex-1">
          {/* Keyed by step, so each card starts at the top of its own scroll, however far the last answer was read. */}
          <div key={step} className="min-w-0 flex-1 overflow-y-auto">
            <div className={cn(COLUMN, 'px-4 pb-8 pt-2 md:pt-8')}>
              {skippedLine}
              <ReviewCard card={current} revealed={revealed} focusKey={step} onOpenAnchor={(anchor) => setPanel({ step, anchor })} />
            </div>
          </div>
          {openAnchor && (
            <ArticlePanel
              anchor={openAnchor}
              desktop={desktop}
              onClose={() => setPanel(null)}
              onOpenInReader={() => openInReader(openAnchor)}
              showToast={(message, type = 'info') => setToast({ message, type })}
            />
          )}
        </div>
        <GradeBar
          revealed={revealed}
          anteprima={current.anteprima}
          practice={practice}
          onReveal={reveal}
          onGrade={(rating) => {
            recordGrade(rating);
            void grade(rating);
          }}
          disabled={saving}
          saveError={saveError}
          note={note}
          noteKey={noteKey}
        />
      </>
    );
  }

  return (
    <section aria-label="Ripasso" className="flex h-full min-h-0 flex-1 flex-col">
      {/* A live region of its own, not a second «status»: the screen's status line is the skipped card's. */}
      <p aria-live="polite" className="sr-only">
        {goalMet ? `Obiettivo di oggi raggiunto · serie di ${goalMet.serie} ${goalMet.serie === 1 ? 'giorno' : 'giorni'}` : ''}
      </p>
      <header className="relative shrink-0 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className={cn(COLUMN, 'relative flex items-center gap-3')}>
          <button
            type="button"
            onClick={leave}
            aria-label={showCard ? 'Interrompi' : 'Chiudi'}
            className={cn(
              'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50',
              FOCUS_RING,
            )}
          >
            <X size={20} aria-hidden />
            <span aria-hidden className="hidden md:inline">
              {showCard ? 'Interrompi' : 'Chiudi'}
            </span>
          </button>
          <LessonProgress done={total - remaining} total={total} />
          {showCard && <p className="sr-only">{remaining === 1 ? 'Resta 1' : `Restano ${remaining}`}</p>}
          {/* «+20 XP» sits over the bar's end, inside the header's row and out of the flow: the bar never shrinks for it,
              it never reaches the card, and the card never waits. While the goal's notice covers the row it waits, and
              comes once the notice has gone (a gain already shown is never shown again). */}
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center">
            <XpGain gain={celebrating ? null : xpGain} />
          </div>
        </div>
        {/* Over the header's row, as on the old page: beside the card, never on it. */}
        {celebrating && (
          <SessionCelebration
            giorno={goalMet.giorno}
            serie={goalMet.serie}
            onStart={() => markCelebrated(goalMet.giorno)}
            onDone={() => setNoticeDone(goalMet.giorno)}
          />
        )}
      </header>
      {middle}
      <ConfirmDialog
        open={confirmStop}
        title="Interrompere il ripasso?"
        message="Le schede già valutate restano registrate."
        confirmLabel="Interrompi"
        cancelLabel="Continua"
        onConfirm={() => navigate(HOME_PATH)}
        onCancel={() => setConfirmStop(false)}
      />
      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        {/* At the top: the bar at the foot holds the grades on every width. */}
        <Toast position="top" message={toast?.message ?? ''} type={toast?.type ?? 'info'} isVisible={toast !== null} onClose={() => setToast(null)} />
      </div>
    </section>
  );
}
