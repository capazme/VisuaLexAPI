import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { Z_INDEX } from '../../../../constants/zIndex';
import { useIsDesktop } from '../../../../hooks/useIsDesktop';
import { corsiErrorDetail, corsiService, isNotFound, isUnreachable } from '../../../../services/corsiService';
import type { BloccoLezione, Chiave, CitazioneLezione, ModuloLezione } from '../../../../types/corsi';
import { Toast } from '../../../ui/Toast';
import { WireConfirm } from '../../../ui/wireConfirm/WireConfirm';
import { LessonBar } from '../GradeBar';
import { LessonLoading } from '../LessonFrame';
import { LESSON_PRIMARY } from '../lessonStyles';
import { BLOCK_HEADING, FOCUS_RING, MUTED_TEXT, QUIET_BUTTON, TILE } from '../progress/tokens';
import { CitationPanel } from './CitationPanel';
import { CoursesGate } from './CoursesGate';
import { coursePath } from './corsiLabels';
import { useCoursesSwitch } from './coursesSwitch';
import { citationLabel } from './lessonCitations';
import { blockMinutes } from './lessonFormat';
import { LessonText } from './LessonText';
import {
  EMPTY_WORK,
  PAUSE_EVERY_MS,
  forgetWork,
  moduleSteps,
  readStepReached,
  readWork,
  saveStepReached,
  saveWork,
  stepLine,
  stopMessage,
  withOutcome,
  type BlockWork,
  type Passo,
} from './moduleSteps';
import { RecallStep } from './RecallStep';
import { loadAssistantFeatures } from '../../../../store/assistantProposals';

/** The lesson's column, as the review's: the text and the header's row share its width. */
const COLUMN = 'mx-auto w-full max-w-3xl';

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;
type Read = { status: 'loading' } | { status: 'error'; notFound: boolean; offline: boolean } | { status: 'ready' };
/** A read's outcome, named by the read it answers: an outcome for an earlier read is a read still on its way. */
type Outcome = { key: number; read: Read };

const blockWhere = (blocco: number, total: number) => `Blocco ${blocco + 1} di ${total}`;

/**
 * A module's session (`/studia/percorsi/:id/moduli/:moduloId`, courses spec §5 and §6.5), drawn as the lesson in
 * `LessonFrame`: «Passo 4 di 11 · Richiamo» at the top with the close button, the step in the middle, the one action at
 * the foot. Behind the switch `lingo_courses`, as every page of «Percorsi».
 */
export function ModuleSession() {
  const { id = '', moduloId = '' } = useParams();
  const on = useCoursesSwitch() === 'on';
  if (!on) {
    // The frame covers the shell: the close button and Esc stay while the switch is read (or could not be).
    return (
      <LessonLoading>
        <CoursesGate>{null}</CoursesGate>
      </LessonLoading>
    );
  }
  return <Session key={`${id}/${moduloId}`} id={id} moduloId={moduloId} />;
}

function Session({ id, moduloId }: { id: string; moduloId: string }) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [reads, setReads] = useState(0);
  /** The read whose 404 the features were read again for. */
  const [featuresRead, setFeaturesRead] = useState(-1);
  const [outcome, setOutcome] = useState<Outcome>({ key: -1, read: { status: 'loading' } });
  const read: Read = outcome.key === reads ? outcome.read : { status: 'loading' };
  const setRead = (r: Read) => setOutcome({ key: reads, read: r });
  const [modulo, setModulo] = useState<ModuloLezione | null>(null);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(false);
  // Each block's highlights, free recall and phase: kept in this tab, so a reload, the browser's back or a swipe back
  // loses none of them (`readWork`); never sent (§8).
  const [work, setWork] = useState<Record<string, BlockWork>>(() => readWork(moduloId));
  useEffect(() => saveWork(moduloId, work), [moduloId, work]);
  /** The citation open beside the text, the view it belongs to, and the button that opened it (the focus goes back). */
  const [panel, setPanel] = useState<{ key: string; citation: CitazioneLezione; opener: HTMLElement } | null>(null);
  /** What «Interrompi» does once confirmed: leave to the course, or where a reader's link was going. */
  const [onStop, setOnStop] = useState<(() => void) | null>(null);
  const [opening, setOpening] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [confirmStop, setConfirmStop] = useState(false);
  const [closeButton, setCloseButton] = useState<HTMLButtonElement | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const back = useCallback(() => navigate(coursePath(id)), [navigate, id]);

  // One read: the content is frozen once opened (§9), and the outcomes this session writes are merged in from the answers.
  useEffect(() => {
    let live = true;
    corsiService.module(id, moduloId).then(
      (data) => {
        if (!live) return;
        setModulo(data);
        // A module opened before resumes at the step this device reached; one not opened starts at its start.
        setStep(data.stato === 'da-iniziare' ? 0 : (readStepReached(data.id, moduleSteps(data).length) ?? 0));
        setOutcome({ key: reads, read: { status: 'ready' } });
      },
      (error: unknown) => {
        if (!live) return;
        console.warn('[Percorsi] module read failed', error);
        const notFound = isNotFound(error);
        setOutcome({ key: reads, read: { status: 'error', notFound, offline: isUnreachable(error) } });
        // A 404 may be the switch turned off meanwhile: the features are read again before «non c’è più» is said, and
        // an «off» sends the gate back to Oggi.
        if (notFound) void loadAssistantFeatures().finally(() => live && setFeaturesRead(reads));
      },
    );
    return () => {
      live = false;
    };
  }, [id, moduloId, reads]);

  const steps = useMemo(() => (modulo ? moduleSteps(modulo) : []), [modulo]);
  const passo: Passo | undefined = steps[step];
  const blockOf = (passo?.tipo === 'lettura' || passo?.tipo === 'richiamo') && modulo ? modulo.blocchi[passo.blocco] : undefined;
  const workOf = (blocco: BloccoLezione) => work[blocco.id] ?? EMPTY_WORK;
  // What is on screen: the step, and within a recall its phase. Each starts at its top with its heading focused.
  const stepKey = preview ? 'anteprima' : `passo-${step}`;
  const viewKey = !preview && passo?.tipo === 'richiamo' && blockOf ? `${stepKey}-${workOf(blockOf).fase}` : stepKey;
  // A citation belongs to the view it was opened in: a recall's next phase closes it, and the phase's heading takes the focus.
  const openCitation = panel && panel.key === viewKey ? panel.citation : null;
  // Closed by its button or Esc, the focus goes back to the citation that opened it, if it is still drawn.
  const closePanel = () => {
    const opener = panel?.opener;
    setPanel(null);
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus({ preventScroll: true }));
  };
  const setWorkOf = (blocco: BloccoLezione, patch: Partial<BlockWork>) => setWork((w) => ({ ...w, [blocco.id]: { ...(w[blocco.id] ?? EMPTY_WORK), ...patch } }));

  const written = Object.values(work).some((w) => w.scritto.trim() !== '');
  const highlighted = Object.values(work).some((w) => w.spans.length > 0);
  const asksToStop = written || highlighted;
  // Closing the tab loses what this tab keeps: the browser asks first (as a large import does, `DossierDetailView`).
  // A reload, the browser's back or a swipe back lose nothing: the work is read back with the module.
  useEffect(() => {
    if (!asksToStop) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [asksToStop]);
  const leaveThen = (go: () => void) => {
    if (!asksToStop) return go();
    setOnStop(() => go);
    setConfirmStop(true);
  };
  const leave = () => leaveThen(back);
  const showPreview = (on: boolean) => {
    setPanel(null);
    setPreview(on);
  };

  // The step's heading takes the focus as the step changes, so a screen reader hears where it is; the scroll is keyed by
  // step, so each starts at its top.
  const heading = useRef<HTMLHeadingElement | null>(null);
  const setHeading = useCallback((el: HTMLHeadingElement | null) => {
    heading.current = el;
  }, []);
  // In the commit: a key pressed as soon as the step is drawn must find the focus already there.
  useLayoutEffect(() => {
    if (read.status !== 'loading') heading.current?.focus({ preventScroll: true });
  }, [viewKey, read.status]);

  const goTo = (next: number) => {
    setPanel(null);
    setStep(next);
    if (modulo && modulo.stato !== 'da-iniziare') saveStepReached(modulo.id, next);
  };

  const start = async () => {
    if (!modulo) return;
    if (modulo.stato !== 'da-iniziare') {
      setPreview(false);
      goTo(1);
      return;
    }
    setOpening('busy');
    try {
      const avanzamento = await corsiService.openModule(id, moduloId);
      setModulo({ ...modulo, stato: 'in-corso', avanzamento });
      setOpening('idle');
      setPreview(false);
      setPanel(null);
      setStep(1);
      saveStepReached(modulo.id, 1);
    } catch (error) {
      console.warn('[Percorsi] module open failed', error);
      setOpening('failed');
      if (isNotFound(error)) setRead({ status: 'error', notFound: true, offline: false });
    }
  };

  // A choice that did not arrive is «Non registrato: riprova»; one the server refused says the server's words.
  const answer = async (domandaId: string, scelta: Chiave) => {
    try {
      const esito = await corsiService.answer(id, moduloId, domandaId, scelta);
      setModulo((m) => (m ? withOutcome(m, domandaId, esito) : m));
    } catch (error) {
      console.warn('[Percorsi] answer failed', error);
      const status = (error as { status?: number } | null)?.status ?? 0;
      throw new Error(status >= 400 && status < 500 ? corsiErrorDetail(error, 'riprova.') : 'riprova.');
    }
  };

  // Esc closes the citation beside the text first (on a phone the sheet closes itself), then leaves or asks. A dialog or
  // a sheet over the lesson keeps its own Esc, as a field's own handler (the floating «Evidenzia» stops it).
  const panelOpen = useRef(false);
  const escape = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    panelOpen.current = openCitation !== null && desktop;
    escape.current = () => {
      if (panelOpen.current) closePanel();
      else leave();
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], [data-find-overlay]')) return;
      // A sheet that closed itself on this very key is gone by now: its key is still not the lesson's.
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"], [data-find-overlay]')) return;
      event.preventDefault();
      escape.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // A comfort pause every 25 minutes or so (§5, step 2): one line in the bar, until the step changes.
  const [pause, setPause] = useState<{ step: string; minutes: number } | null>(null);
  const stepNow = useRef(stepKey);
  useLayoutEffect(() => {
    stepNow.current = stepKey;
  });
  useEffect(() => {
    const opened = Date.now();
    let said = 0;
    const timer = window.setInterval(() => {
      const periods = Math.floor((Date.now() - opened) / PAUSE_EVERY_MS);
      if (periods > said) {
        said = periods;
        setPause({ step: stepNow.current, minutes: periods * 25 });
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const pauseLine = pause && pause.step === stepKey ? `Studi da ${pause.minutes} minuti: se vuoi, fai una pausa.` : null;

  // The reading's progress, tied to scrolling (§5, step 2): never a timer. A view that fits the screen is read whole.
  const [scroll, setScroll] = useState({ key: viewKey, share: 0 });
  const scrolled = scroll.key === viewKey ? scroll.share : 0;
  const measured = scroll.key === viewKey;
  const measure = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && !measured && el.scrollHeight <= el.clientHeight) setScroll({ key: viewKey, share: 1 });
    },
    [measured, viewKey],
  );
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const room = el.scrollHeight - el.clientHeight;
    setScroll({ key: viewKey, share: room <= 0 ? 1 : Math.min(1, el.scrollTop / room) });
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => setToast({ message, type });
  const citeIn = (blocco: BloccoLezione) => {
    const labels = new Map(blocco.citazioni.map((c) => [c.marcatore, citationLabel(c)]));
    const open = (marker: string, opener: HTMLElement) => {
      const citation = blocco.citazioni.find((c) => c.marcatore === marker);
      if (citation) setPanel({ key: viewKey, citation, opener });
    };
    return { labels, open };
  };

  let middle: React.ReactNode;
  let bar: React.ReactNode;
  let status: React.ReactNode = pauseLine;

  // A 404 waits for the features read again: «non c’è più» is said only while the switch is still on.
  const checkingSwitch = read.status === 'error' && read.notFound && featuresRead !== reads;
  if (read.status === 'loading' || checkingSwitch) {
    middle = (
      <div className={cn(COLUMN, 'px-4 py-6')}>
        <p className="sr-only">Carico il modulo…</p>
        <div aria-hidden className="h-72 rounded-2xl border border-slate-200 bg-white motion-safe:animate-pulse dark:border-slate-800 dark:bg-slate-900" />
      </div>
    );
    bar = <div aria-hidden className="h-12 rounded-xl bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />;
  } else if (read.status === 'error' || !modulo || !passo) {
    const notFound = read.status === 'error' && read.notFound;
    const offline = read.status === 'error' && read.offline;
    middle = (
      <div className={cn(COLUMN, 'px-4 py-8')}>
        <h1 ref={setHeading} tabIndex={-1} role="alert" className="font-serif text-xl leading-snug text-red-700 focus:outline-none dark:text-red-400">
          {notFound ? 'Questo modulo non c’è più: forse è stato eliminato.' : offline ? 'Sei offline o il server non risponde: non riesco a leggere il modulo.' : 'Non riesco a leggere il modulo.'}
        </h1>
      </div>
    );
    bar = notFound ? (
      <button type="button" onClick={back} className={LESSON_PRIMARY}>
        Torna al percorso
      </button>
    ) : (
      <button type="button" onClick={() => setReads((n) => n + 1)} className={LESSON_PRIMARY}>
        Riprova
      </button>
    );
  } else if (preview) {
    middle = (
      <div className={cn(COLUMN, 'grid grid-cols-1 gap-8 px-4 pb-10 pt-4 md:pt-8')}>
        <div className="grid grid-cols-1 gap-1">
          <p className={cn('text-sm font-medium', MUTED_TEXT)}>Anteprima: il modulo non è ancora iniziato</p>
          <h1 ref={setHeading} tabIndex={-1} className="break-words font-serif text-2xl font-medium tracking-tight text-slate-900 focus:outline-none md:text-3xl dark:text-slate-50">
            {modulo.titolo}
          </h1>
        </div>
        {modulo.blocchi.map((blocco, i) => {
          const cites = citeIn(blocco);
          return (
            <section key={blocco.id} aria-labelledby={`anteprima-${blocco.id}`} className="grid grid-cols-1 gap-3">
              <h2 id={`anteprima-${blocco.id}`} className={BLOCK_HEADING}>
                {blocco.titolo ?? blockWhere(i, modulo.blocchi.length)}
              </h2>
              <LessonText text={blocco.testo} citations={cites.labels} onCite={cites.open} />
            </section>
          );
        })}
      </div>
    );
    bar = <StartActions modulo={modulo} opening={opening} onStart={() => void start()} onPreview={() => showPreview(false)} previewLabel="Torna all’inizio" />;
    if (opening === 'failed') status = <FailedOpen />;
  } else if (passo.tipo === 'inizio') {
    middle = <ModuleStart modulo={modulo} headingRef={setHeading} />;
    bar = (
      <StartActions
        modulo={modulo}
        opening={opening}
        onStart={() => void start()}
        onPreview={() => showPreview(true)}
        previewLabel="Leggi senza iniziare"
      />
    );
    if (opening === 'failed') status = <FailedOpen />;
  } else if (passo.tipo === 'lettura' && blockOf) {
    const cites = citeIn(blockOf);
    const total = modulo.blocchi.length;
    const words = modulo.blocchi.reduce((sum, b) => sum + b.parole, 0);
    const minutes = blockMinutes(blockOf.parole, words, modulo.minuti);
    middle = (
      <div className={cn(COLUMN, 'grid grid-cols-1 gap-5 px-4 pb-10 pt-4 md:pt-8')}>
        <div className="grid grid-cols-1 gap-1">
          <p className={cn('text-sm font-medium', MUTED_TEXT)}>
            {blockWhere(passo.blocco, total)} · circa {minutes} {minutes === 1 ? 'minuto' : 'minuti'} di lettura
          </p>
          <h1 ref={setHeading} tabIndex={-1} className="break-words font-serif text-2xl font-medium tracking-tight text-slate-900 focus:outline-none md:text-3xl dark:text-slate-50">
            {blockOf.titolo ?? modulo.titolo}
          </h1>
        </div>
        {modulo.domandePrima.length > 0 && (
          <details className={cn(TILE, 'group p-4')}>
            <summary className={cn('-m-2 flex min-h-[44px] cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-slate-800 dark:text-slate-100', FOCUS_RING)}>
              Le domande guida
            </summary>
            <PreQuestions domande={modulo.domandePrima} />
          </details>
        )}
        <LessonText
          text={blockOf.testo}
          headingLevel={2}
          spans={workOf(blockOf).spans}
          onSpans={(spans) => setWorkOf(blockOf, { spans })}
          citations={cites.labels}
          onCite={cites.open}
        />
      </div>
    );
    bar = (
      <button type="button" onClick={() => goTo(step + 1)} className={LESSON_PRIMARY}>
        Ho letto: al richiamo
      </button>
    );
  } else if (passo.tipo === 'richiamo' && blockOf) {
    const cites = citeIn(blockOf);
    const mine = workOf(blockOf);
    const questions = blockOf.richiamo.length > 0;
    middle = (
      <div className={cn(COLUMN, 'px-4 pb-10 pt-4 md:pt-8', mine.fase === 'confronta' && 'lg:max-w-6xl')}>
        <RecallStep
          blocco={blockOf}
          where={blockWhere(passo.blocco, modulo.blocchi.length)}
          fase={mine.fase}
          scritto={mine.scritto}
          onScritto={(scritto) => setWorkOf(blockOf, { scritto })}
          spans={mine.spans}
          onSpans={(spans) => setWorkOf(blockOf, { spans })}
          citations={cites.labels}
          onCite={cites.open}
          onAnswer={answer}
          headingRef={setHeading}
        />
      </div>
    );
    const next = () => goTo(step + 1);
    if (mine.fase === 'scrivi') {
      bar = (
        <button type="button" onClick={() => setWorkOf(blockOf, { fase: 'confronta' })} className={LESSON_PRIMARY}>
          Confronta con il testo
        </button>
      );
    } else if (mine.fase === 'confronta' && questions) {
      bar = (
        <button type="button" onClick={() => setWorkOf(blockOf, { fase: 'domande' })} className={LESSON_PRIMARY}>
          Alle domande
        </button>
      );
    } else {
      bar = (
        <button type="button" onClick={next} className={LESSON_PRIMARY}>
          Avanti
        </button>
      );
    }
  } else {
    middle = (
      <div className={cn(COLUMN, 'px-4 py-8 md:py-14')}>
        <section className={cn(TILE, 'mx-auto grid max-w-xl gap-3 p-6 text-center md:p-8')}>
          <h1 ref={setHeading} tabIndex={-1} className="font-serif text-2xl leading-snug text-slate-900 focus:outline-none md:text-3xl dark:text-slate-50">
            Hai finito la lettura del modulo.
          </h1>
          <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">
            Il quiz, la domanda aperta e la fine del modulo arrivano con il prossimo aggiornamento dei Percorsi.
          </p>
        </section>
      </div>
    );
    bar = (
      <button type="button" onClick={back} className={LESSON_PRIMARY}>
        Torna al percorso
      </button>
    );
  }

  const reading = !preview && passo?.tipo === 'lettura';
  return (
    <section aria-label={modulo ? `Modulo ${modulo.ordine}: ${modulo.titolo}` : 'Modulo'} className="flex h-full min-h-0 flex-1 flex-col">
      {/* A live region of its own, there from the first draw, so the pause's line is read when it comes. */}
      <p aria-live="polite" className="sr-only">
        {pauseLine ?? ''}
      </p>
      <header className="relative shrink-0 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className={cn(COLUMN, 'flex items-center gap-3')}>
          <button
            ref={setCloseButton}
            type="button"
            onClick={leave}
            aria-label="Chiudi il modulo"
            className={cn(
              'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50',
              FOCUS_RING,
            )}
          >
            <X size={20} aria-hidden />
            <span aria-hidden className="hidden md:inline">
              Chiudi
            </span>
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
            {modulo && passo ? (preview ? `Anteprima · ${modulo.titolo}` : stepLine(step, steps)) : ''}
          </p>
        </div>
        {/* The reading's progress, tied to scrolling: a thin line under the header, decorative (the scroll says it too). */}
        <div aria-hidden className={cn('absolute inset-x-0 bottom-0 h-0.5', reading ? 'bg-slate-200 dark:bg-slate-800' : 'bg-transparent')}>
          {reading && <div data-testid="lettura-avanzamento" className="vlx-lesson-ink h-full" style={{ width: `${scrolled * 100}%` }} />}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div key={viewKey} ref={measure} onScroll={onScroll} className="min-w-0 flex-1 overflow-y-auto">
          {middle}
        </div>
        {openCitation && (
          <CitationPanel citation={openCitation} desktop={desktop} onClose={closePanel} leaveThen={leaveThen} showToast={showToast} />
        )}
      </div>
      <LessonBar status={status}>{bar}</LessonBar>
      <WireConfirm
        open={confirmStop}
        title="Interrompi il modulo?"
        message={stopMessage(written, highlighted)}
        confirmLabel="Interrompi"
        cancelLabel="Continua il modulo"
        emphasis="cancel"
        origin={closeButton}
        focusBack={() => heading.current}
        onConfirm={() => {
          // Stopping is the user's word: what was written goes now, not only with the tab.
          forgetWork(moduloId);
          (onStop ?? back)();
        }}
        onCancel={() => {
          setConfirmStop(false);
          setOnStop(null);
        }}
      />
      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        <Toast position="top" message={toast?.message ?? ''} type={toast?.type ?? 'info'} isVisible={toast !== null} onClose={() => setToast(null)} />
      </div>
    </section>
  );
}

function FailedOpen() {
  return (
    <span role="alert" className="text-red-700 dark:text-red-400">
      Non registrato: riprova.
    </span>
  );
}

function PreQuestions({ domande }: { domande: string[] }) {
  return (
    <ol className="mt-3 grid list-decimal grid-cols-1 gap-2 pl-6 font-serif text-lg leading-snug text-slate-900 marker:font-sans marker:text-sm marker:text-slate-500 dark:text-slate-100">
      {domande.map((d, i) => (
        <li key={i} className="break-words">
          {d}
        </li>
      ))}
    </ol>
  );
}

/** The module's start (§5, step 1): what it is for, how long, its pre-questions, and what starting it means. */
function ModuleStart({ modulo, headingRef }: { modulo: ModuloLezione; headingRef: (el: HTMLHeadingElement | null) => void }) {
  const facts = [`Modulo ${modulo.ordine}`, `${modulo.blocchi.length} ${modulo.blocchi.length === 1 ? 'blocco' : 'blocchi'}`];
  if (modulo.minuti !== null) facts.push(`circa ${modulo.minuti} minuti`);
  return (
    <div className={cn(COLUMN, 'grid grid-cols-1 gap-6 px-4 pb-10 pt-4 md:pt-8')}>
      <div className="grid grid-cols-1 gap-1">
        <p className={cn('break-words text-sm font-medium', MUTED_TEXT)}>{modulo.corso.titolo}</p>
        <h1 ref={headingRef} tabIndex={-1} className="break-words font-serif text-2xl font-medium tracking-tight text-slate-900 focus:outline-none md:text-3xl dark:text-slate-50">
          {modulo.titolo}
        </h1>
        <p className={cn('text-sm', MUTED_TEXT)}>{facts.join(' · ')}</p>
      </div>
      {modulo.competenze.length > 0 && (
        <section aria-labelledby="modulo-competenze" className="grid grid-cols-1 gap-2">
          <h2 id="modulo-competenze" className={BLOCK_HEADING}>
            A che cosa serve
          </h2>
          <ul className="grid grid-cols-1 gap-2">
            {modulo.competenze.map((c) => (
              <li key={c.codice} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-base leading-relaxed text-slate-800 dark:text-slate-200">
                <span className="pt-0.5 font-mono text-sm font-semibold text-slate-500 dark:text-slate-400">{c.codice}</span>
                <span className="break-words">{c.testo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {modulo.domandePrima.length > 0 && (
        <section aria-labelledby="modulo-domande-prima" className={cn(TILE, 'grid grid-cols-1 gap-1 p-4 md:p-5')}>
          <h2 id="modulo-domande-prima" className={BLOCK_HEADING}>
            Prima di leggere
          </h2>
          <p className="max-w-[65ch] text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            Tieni a mente queste domande: le ritrovi leggendo. Non c’è da rispondere qui, e le rivedi sopra ogni blocco.
          </p>
          <PreQuestions domande={modulo.domandePrima} />
        </section>
      )}
      {modulo.ritirato && <p className={cn('text-sm', MUTED_TEXT)}>Hai ritirato questo modulo: le sue risposte non contano più, conta la correzione.</p>}
      {modulo.stato === 'da-iniziare' && (
        <p className="max-w-[65ch] text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          Una volta iniziato, il modulo resta nel percorso: non potrai più eliminarlo. Se vuoi solo vedere com’è, leggilo senza iniziarlo.
        </p>
      )}
    </div>
  );
}

function StartActions({
  modulo,
  opening,
  onStart,
  onPreview,
  previewLabel,
}: {
  modulo: ModuloLezione;
  opening: 'idle' | 'busy' | 'failed';
  onStart: () => void;
  onPreview: () => void;
  previewLabel: string;
}) {
  const notStarted = modulo.stato === 'da-iniziare';
  const label = notStarted ? (opening === 'busy' ? 'Inizio il modulo…' : 'Inizia il modulo') : 'Comincia a leggere';
  return (
    <div className="grid w-full justify-items-center gap-1">
      <button type="button" onClick={onStart} disabled={opening === 'busy'} aria-busy={opening === 'busy' || undefined} className={cn(LESSON_PRIMARY, 'disabled:opacity-70')}>
        {label}
      </button>
      {notStarted && (
        <button type="button" onClick={onPreview} className={cn(QUIET_BUTTON, 'mx-0 justify-self-center text-center')}>
          {previewLabel}
        </button>
      )}
    </div>
  );
}
