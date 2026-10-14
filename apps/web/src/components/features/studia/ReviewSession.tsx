import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { useAppStore } from '../../../store/useAppStore';
import type { AncoraScheda, Materia } from '../../../types/studia';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Toast } from '../../ui/Toast';
import { DossierItemReader } from '../dossier/DossierItemReader';
import { formatInterval } from './formatInterval';
import { GradeBar } from './GradeBar';
import { ReviewCard } from './ReviewCard';
import { Sheet } from '../../ui/Sheet';
import { MATERIA_LABEL, anchorLabel, normaFromAnchor, searchParamsFromAnchor } from './studiaLabels';
import { SessionCelebration } from './progress/Celebration';
import { SessionEndProgress } from './progress/SessionEndProgress';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { useReviewSession, type ReviewSummary } from './useReviewSession';

const HOME_PATH = '/studia/ripasso';

const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors md:min-h-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

const schede = (n: number) => (n === 1 ? '1 scheda' : `${n} schede`);

/** «Hai ripassato 23 schede, 4 da rifare. Le prossime: domani.» */
function endSentence({ reviewed, again, nextDue }: ReviewSummary): string {
  if (reviewed === 0) return 'Nessuna scheda da ripassare per ora.';
  const redo = again === 0 ? 'nessuna da rifare' : `${again} da rifare`;
  const next = nextDue === null ? '' : ` Le prossime: ${formatInterval(nextDue)}.`;
  return `Hai ripassato ${schede(reviewed)}, ${redo}.${next}`;
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
  return (
    <aside
      aria-label="Articolo"
      className="min-w-0 rounded-lg border border-slate-200 p-4 md:sticky md:top-0 md:max-h-screen md:overflow-y-auto dark:border-slate-800"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi l’articolo"
          className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {reader}
    </aside>
  );
}

/**
 * A review session (`/studia/ripasso/sessione?materia=`): one card at a time, the answer on
 * request, four grades. The queue lives in `useReviewSession`, so opening and closing an anchor's
 * article leaves it as it was. Esc asks before leaving; what was graded is already recorded.
 */
export function ReviewSession() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const triggerSearch = useAppStore((s) => s.triggerSearch);

  const requested = params.get('materia');
  const materia = requested && Object.keys(MATERIA_LABEL).includes(requested) ? (requested as Materia) : undefined;

  const [confirmStop, setConfirmStop] = useState(false);
  const [panel, setPanel] = useState<{ step: number; anchor: AncoraScheda } | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  // Esc closes the article beside the card first (on a phone the sheet closes itself); a second one asks to stop.
  const panelOpen = useRef(false);
  const handleEscape = useCallback(() => {
    if (panelOpen.current) setPanel(null);
    else setConfirmStop(true);
  }, []);

  const { current, revealed, reveal, grade, remaining, done, summary, practice, step, loading, loadError, saveError, skipped, saving, reload, goalMet } =
    useReviewSession(materia, { paused: confirmStop, onEscape: handleEscape });
  // The grade that made the day count plays the celebration, once a day for this browser (spec decision 10).
  const { celebrated, markCelebrated } = useCelebratedToday();
  const celebrating = goalMet !== null && !celebrated(goalMet.giorno);

  // An article belongs to the step it was opened at: a card that comes back is a new step.
  const openAnchor = panel && current && panel.step === step ? panel.anchor : null;
  useEffect(() => {
    panelOpen.current = openAnchor !== null && desktop;
  }, [openAnchor, desktop]);

  const openInReader = (anchor: AncoraScheda) => {
    const searchParams = searchParamsFromAnchor(anchor);
    if (!searchParams) return;
    navigate('/');
    triggerSearch(searchParams);
  };

  let body;
  if (loadError) {
    body = (
      <div role="alert" className="space-y-3 text-sm text-red-600 dark:text-red-400">
        <p>Non riesco a leggere le schede da ripassare.</p>
        <button type="button" onClick={() => void reload()} className={cn(BUTTON, 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200')}>
          Riprova
        </button>
      </div>
    );
  } else if (loading) {
    body = <p className="text-sm text-slate-500 dark:text-slate-400">Carico le schede…</p>;
  } else if (done || !current) {
    body = (
      <div className="space-y-4">
        <p className="max-w-[60ch] font-serif text-xl leading-[1.7] text-slate-900 dark:text-slate-50">{endSentence(summary)}</p>
        <SessionEndProgress />
        <button type="button" onClick={() => navigate(HOME_PATH)} className={cn(BUTTON, 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800')}>
          Torna al ripasso
        </button>
      </div>
    );
  } else {
    body = (
      <div className={cn(openAnchor && desktop && 'md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] md:items-start md:gap-8')}>
        <div className="min-w-0">
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">{remaining === 1 ? 'Resta 1' : `Restano ${remaining}`}</p>
            <button
              type="button"
              onClick={() => setConfirmStop(true)}
              className={cn(BUTTON, 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}
            >
              Interrompi
            </button>
          </div>
          <ReviewCard card={current} revealed={revealed} focusKey={step} onOpenAnchor={(anchor) => setPanel({ step, anchor })} />
          <GradeBar revealed={revealed} anteprima={current.anteprima} practice={practice} onReveal={reveal} onGrade={(rating) => void grade(rating)} disabled={saving} saveError={saveError} />
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
    );
  }

  return (
    // Room for the bar pinned at the bottom of a phone.
    <section aria-label="Ripasso" className="pb-28 md:pb-0">
      {/* A live region of its own, not a second «status»: the screen's status line is the skipped card's. */}
      <p aria-live="polite" className="sr-only">
        {goalMet ? `Obiettivo di oggi raggiunto · serie di ${goalMet.serie} ${goalMet.serie === 1 ? 'giorno' : 'giorni'}` : ''}
      </p>
      {celebrating && <SessionCelebration giorno={goalMet.giorno} serie={goalMet.serie} onDone={() => markCelebrated(goalMet.giorno)} />}
      {skipped && (
        <p role="status" className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          Questa scheda non è più da ripassare.
        </p>
      )}
      {body}
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
        <Toast message={toast?.message ?? ''} type={toast?.type ?? 'info'} isVisible={toast !== null} onClose={() => setToast(null)} />
      </div>
    </section>
  );
}
