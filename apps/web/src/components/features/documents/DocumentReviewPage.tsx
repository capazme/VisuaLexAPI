/**
 * «Analizza documento»: the norms a document cites, found in the browser (brief D2). The file is read
 * here and never sent anywhere — the promise of the page; each citation opens the reader as a search
 * would (`openCitation`, gotcha 15). The document is drawn as it is, its citations marked in it, and
 * listed beside it by act.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FileText, RotateCcw, ShieldCheck } from 'lucide-react';
import { extractCitations, type CitationMatch } from '../../../utils/citationMatcher';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../ui/Button';
import { FOCUS_RING } from '../../../constants/interactions';
import { dur, ease } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import { citationCountLabel, groupCitationsByAct } from './citationGroups';
import { CitationList } from './CitationList';
import { DOCUMENT_ACCEPT, readDocumentFile } from './documentFile';
import { DocumentText } from './DocumentText';
import { DropZone, type DropPhase } from './DropZone';
import { DocumentRow, SheetFlight } from './DocumentRow';
import { documentKind, type DocumentJob } from './documentJob';
import { PageFrame } from '../../layout/PageFrame';

interface LoadedDocument {
  fileName: string;
  text: string;
  /** Found while the row said «Cerco le citazioni…». */
  citations: CitationMatch[];
}

/** How long the check stays on the row before the text comes (D6): the time to see it. */
const DONE_MS = 450;
/** A file over the window with no `dragover` for this long has gone: the box rests again. */
const DRAG_REST_MS = 200;

/** A phone: no dragging there (D6). */
const isTouch = () => typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

/** The next frame drawn, then the task after it: the row's new words are on screen before the work goes on. */
const nextPaint = () => new Promise<void>((resolve) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(resolve, 0)) : setTimeout(resolve, 0)));

const hasFiles = (event: DragEvent | globalThis.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scrolls `container` alone (never the page) so that `target` sits a third of the way down it. */
function scrollWithin(container: HTMLElement, target: HTMLElement, behavior: ScrollBehavior) {
  const top = target.offsetTop - container.clientHeight / 3;
  container.scrollTo?.({ top: Math.max(0, top), behavior });
}

/** On a phone the columns are stacked: bring `panel` wholly into sight when part of it is off the screen. */
function revealPanel(panel: HTMLElement, behavior: ScrollBehavior) {
  const box = panel.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) panel.scrollIntoView?.({ block: 'nearest', behavior });
}

/**
 * One ring that widens and fades from the citation: where the eye should land, once. A shadow, because a
 * transform does not move an inline element. Its colour is `--doc-pulse`, the theme's toga step set on the
 * text (`DocumentText`), read as a colour because a keyframe cannot be relied on to resolve a `var()`.
 */
function pulse(mark: HTMLElement) {
  if (typeof mark.animate !== 'function') return;
  const colour = getComputedStyle(mark).getPropertyValue('--doc-pulse').trim() || 'currentColor';
  mark.animate(
    [
      { boxShadow: `0 0 0 0 color-mix(in oklch, ${colour} 55%, transparent)` },
      { boxShadow: `0 0 0 7px color-mix(in oklch, ${colour} 0%, transparent)` },
    ],
    // After the smooth scroll has brought it into view.
    { duration: 700, delay: 280, easing: `cubic-bezier(${ease.out.join(', ')})` },
  );
}

// Each column scrolls on its own: a document of 300 pages never makes the page scroll.
const PANEL = 'flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const PANEL_HEAD = 'flex min-h-11 shrink-0 items-center border-b border-slate-200 px-4 text-sm font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300';
// Contained on a computer only: on a phone the stacked panels hand a swipe on to the page at their ends.
const PANEL_BODY = 'relative min-h-0 flex-1 overflow-y-auto lg:overscroll-contain';
const COLUMN_HEIGHT = 'lg:h-[calc(100dvh-17rem)] lg:min-h-[24rem]';

export function DocumentReviewPage() {
  const triggerSearch = useAppStore(s => s.triggerSearch);
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const textBodyRef = useRef<HTMLDivElement>(null);
  const listBodyRef = useRef<HTMLDivElement>(null);
  // The reading in flight: a file chosen while another is read wins, the older answer is dropped.
  const readingRef = useRef(0);
  const focusAfterRef = useRef<'result' | 'zone' | null>(null);

  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  // The file being read, or refused: its row under the box.
  const [job, setJob] = useState<DocumentJob | null>(null);
  const [phase, setPhase] = useState<DropPhase>('idle');
  const [lean, setLean] = useState({ x: 0, y: 0 });
  const [landings, setLandings] = useState(0);
  // The ink sheet thrown to the row, from where it stood.
  const [flight, setFlight] = useState<DOMRect | null>(null);
  const [touch] = useState(isTouch);
  const [selected, setSelected] = useState<number | null>(null);

  const citations = useMemo(() => loaded?.citations ?? [], [loaded]);
  const groups = useMemo(() => (loaded ? groupCitationsByAct(loaded.text, citations) : []), [loaded, citations]);
  const countLabel = citations.length === 0 ? 'Nessuna citazione' : citationCountLabel(citations.length, groups.length);

  // The focus follows the change once its target is mounted: the box and the result take turns
  // (AnimatePresence, `mode="wait"`), so the target appears only after the other has left.
  const focusOnMount = useCallback((target: 'result' | 'zone') => (element: HTMLElement | null) => {
    if (!element || focusAfterRef.current !== target) return;
    focusAfterRef.current = null;
    element.focus({ preventScroll: true });
  }, []);
  const zoneFocus = useMemo(() => focusOnMount('zone'), [focusOnMount]);
  const resultFocus = useMemo(() => focusOnMount('result'), [focusOnMount]);
  const zoneElement = useCallback((element: HTMLButtonElement | null) => {
    zoneRef.current = element;
    zoneFocus(element);
  }, [zoneFocus]);

  /**
   * Reads a file in the browser, its row saying each step: «Leggo il documento…», «Cerco le citazioni…» (the search,
   * after a frame, so the words are on screen while it runs), the check, then the text. A refusal stays on the row.
   * `thrown`: let go on the box, so the sheets land and one flies to the row.
   */
  const handleFile = async (file: File, thrown = false) => {
    const id = ++readingRef.current;
    const base: DocumentJob = { id, name: file.name, bytes: file.size, kind: documentKind(file.name), stage: 'reading' };
    setJob(base);
    if (thrown) {
      setLandings((n) => n + 1);
      // Read now, as the pulse is: reduced motion throws nothing.
      if (!prefersReducedMotion() && sheetRef.current) setFlight(sheetRef.current.getBoundingClientRect());
    }
    const result = await readDocumentFile(file);
    if (id !== readingRef.current) return;
    if (!result.ok) {
      setJob({ ...base, stage: 'error', error: result.error });
      return;
    }
    setJob({ ...base, stage: 'searching' });
    await nextPaint();
    if (id !== readingRef.current) return;
    const found = extractCitations(result.text);
    setJob({ ...base, stage: 'done' });
    await new Promise((resolve) => setTimeout(resolve, DONE_MS));
    if (id !== readingRef.current) return;
    focusAfterRef.current = 'result';
    setJob(null);
    setLoaded({ fileName: file.name, text: result.text, citations: found });
    setSelected(null);
  };
  // The window's listeners (below) live once; the file goes to the handler of the latest render.
  const handleFileRef = useRef(handleFile);
  useEffect(() => {
    handleFileRef.current = handleFile;
  });

  // A file over the window, from `dragover` alone (`dragenter`/`dragleave` fire between children too): over the box or
  // elsewhere, and where on the box; with no event for 200 ms it has gone. Let go anywhere but on the box, the browser
  // would open it in place of the app: refused over the whole window (the margins and the sidebar too).
  useEffect(() => {
    let rest = 0;
    const onBox = (event: globalThis.DragEvent) => Boolean(zoneRef.current?.contains(event.target as Node));
    const over = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const box = onBox(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = box ? 'copy' : 'none';
      setPhase(box ? 'over' : 'page');
      const zone = zoneRef.current;
      if (box && zone) {
        const r = zone.getBoundingClientRect();
        const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
        setLean({ x: clamp(((event.clientX - (r.left + r.width / 2)) / Math.max(1, r.width)) * 24, 8), y: clamp(((event.clientY - (r.top + r.height / 2)) / Math.max(1, r.height)) * 16, 5) });
      }
      window.clearTimeout(rest);
      rest = window.setTimeout(() => setPhase('idle'), DRAG_REST_MS);
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      window.clearTimeout(rest);
      setPhase('idle');
      if (!onBox(event)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
        return;
      }
      const file = event.dataTransfer?.files?.[0];
      if (file) void handleFileRef.current(file, true);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.clearTimeout(rest);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const dismissJob = () => {
    readingRef.current += 1;
    setJob(null);
    zoneRef.current?.focus();
  };

  const chooseAnother = () => {
    readingRef.current += 1;
    setJob(null);
    setPhase('idle');
    setSelected(null);
    focusAfterRef.current = 'zone';
    setLoaded(null);
  };

  const selectFromList = useCallback((index: number) => {
    setSelected(index);
    const body = textBodyRef.current;
    const mark = body?.querySelector<HTMLElement>(`[data-cite="${index}"]`);
    if (!body || !mark) return;
    const still = prefersReducedMotion();
    scrollWithin(body, mark, still ? 'auto' : 'smooth');
    // The citation sits a third of the way down the column: with the column wholly in sight, so is it.
    revealPanel(body, still ? 'auto' : 'smooth');
    if (!still) pulse(mark);
  }, []);

  const selectFromText = useCallback((index: number) => {
    setSelected(index);
    const body = listBodyRef.current;
    const row = body?.querySelector<HTMLElement>(`[data-cite-row="${index}"]`);
    if (!body || !row) return;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    scrollWithin(body, row, behavior);
    revealPanel(body, behavior);
  }, []);

  const openCitation = useCallback((citation: CitationMatch) => {
    // The search runs on the reader page: without navigating first the
    // trigger sits in the store until the user opens `/` by hand (the
    // pattern is HistoryView's handleItemClick).
    navigate('/');
    triggerSearch({
      act_type: citation.parsed.act_type,
      act_number: citation.parsed.act_number ?? '',
      date: citation.parsed.date ?? '',
      article: citation.parsed.article,
      version: 'vigente',
      version_date: '',
    });
  }, [navigate, triggerSearch]);

  return (
    <PageFrame
      title="Analizza documento"
      line="Trova le norme citate in un atto: il file resta nel tuo browser."
      action={
        <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <ShieldCheck aria-hidden="true" size={14} />
          Resta nel tuo browser<span className="sr-only">: il documento non viene inviato al server né salvato.</span>
        </p>
      }
    >

      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        data-testid="document-input"
        onChange={event => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ''; }}
      />

      {/* What happens, said once: «Documento in lettura», «Cerco le citazioni», «Pronto», a refusal, then the count. */}
      <p className="sr-only" aria-live="polite">
        {job?.stage === 'error' ? job.error : job?.stage === 'reading' ? 'Documento in lettura' : job?.stage === 'searching' ? 'Cerco le citazioni' : job?.stage === 'done' ? 'Pronto' : loaded ? countLabel : ''}
      </p>

      {/* One after the other: the box closes, then the result comes. Both at once would lay the columns out
          under a box still closing, and the page would grow a scrollbar for a moment. */}
      <AnimatePresence initial={false} mode="wait">
        {!loaded ? (
          <motion.div
            key="zone"
            className="overflow-hidden"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
            transition={{ duration: dur.panel, ease: ease.drawer }}
          >
            <div className="flex flex-col gap-3 pb-1">
              <DropZone
                ref={zoneElement}
                phase={phase}
                lean={lean}
                landings={landings}
                touch={touch}
                busy={job !== null && job.stage !== 'error'}
                onChoose={() => fileInputRef.current?.click()}
                sheetRef={sheetRef}
              />
              {/* The document's row; a refusal slides away with its ✕. */}
              <AnimatePresence initial={false}>
                {job && (
                  <motion.div
                    key={job.id}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: 48 }}
                    transition={{ duration: dur.pop, ease: ease.out }}
                  >
                    <DocumentRow job={job} onDismiss={dismissJob} markRef={markRef} hidden={flight !== null} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="result"
            className="flex flex-col gap-4"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: reduceMotion ? 0.15 : dur.panel, ease: ease.out }}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <FileText aria-hidden="true" size={18} className="shrink-0 text-slate-500 dark:text-slate-400" />
              <h2
                ref={resultFocus}
                tabIndex={-1}
                title={loaded.fileName}
                className="line-clamp-2 min-w-0 flex-1 basis-48 text-base font-medium text-slate-900 outline-none [overflow-wrap:anywhere] dark:text-slate-50"
              >
                {loaded.fileName}
              </h2>
              <p className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{countLabel}</p>
              {/* 44 px at every width, as the box it brings back. */}
              <Button variant="secondary" icon={<RotateCcw size={15} />} onClick={chooseAnother} className="md:min-h-11">Scegli un altro documento</Button>
            </div>
            {/* Citations first in the order of reading (a phone shows them above the text); on a computer
                the text takes the left column. */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
              <aside aria-labelledby="doc-citations" className={cn(PANEL, COLUMN_HEIGHT, 'max-h-[55dvh] lg:col-start-2 lg:row-start-1 lg:max-h-none')}>
                <h2 id="doc-citations" className={PANEL_HEAD}>Citazioni</h2>
                <div ref={listBodyRef} className={PANEL_BODY}>
                  <CitationList groups={groups} selected={selected} onSelect={selectFromList} onOpen={openCitation} />
                </div>
              </aside>
              <section aria-labelledby="doc-text" className={cn(PANEL, COLUMN_HEIGHT, 'max-h-[80dvh] min-w-0 lg:col-start-1 lg:row-start-1 lg:max-h-none')}>
                <h2 id="doc-text" className={PANEL_HEAD}>Testo del documento</h2>
                {/* Focusable: the marks are not, and Safari does not let the keyboard scroll a region with nothing to focus. */}
                <div
                  ref={textBodyRef}
                  tabIndex={0}
                  role="group"
                  aria-labelledby="doc-text"
                  className={cn(PANEL_BODY, 'px-5 py-6 md:px-8', FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0')}
                >
                  <DocumentText text={loaded.text} citations={citations} selected={selected} onSelect={selectFromText} />
                </div>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {flight && <SheetFlight from={flight} target={markRef} onDone={() => setFlight(null)} />}
    </PageFrame>
  );
}
