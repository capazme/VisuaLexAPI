/**
 * «Analizza documento»: the norms a document cites, found in the browser (brief D2). The file is read
 * here and never sent anywhere — the promise of the page; each citation opens the reader as a search
 * would (`openCitation`, gotcha 15). The document is drawn as it is, its citations marked in it, and
 * listed beside it by act.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, FileText, Loader2, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { extractCitations, type CitationMatch } from '../../../utils/citationMatcher';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../ui/Button';
import { FOCUS_RING, TRANSITION } from '../../../constants/interactions';
import { dur, ease } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import { citationCountLabel, groupCitationsByAct } from './citationGroups';
import { CitationList } from './CitationList';
import { DOCUMENT_ACCEPT, readDocumentFile } from './documentFile';
import { DocumentText } from './DocumentText';

interface LoadedDocument {
  fileName: string;
  text: string;
}

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
  const textBodyRef = useRef<HTMLDivElement>(null);
  const listBodyRef = useRef<HTMLDivElement>(null);
  // The reading in flight: a file chosen while another is read wins, the older answer is dropped.
  const readingRef = useRef(0);
  const focusAfterRef = useRef<'result' | 'zone' | null>(null);

  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // A reading that has lasted 200 ms: only then are «Leggo il documento…» shown and announced, together.
  const [slowReading, setSlowReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const citations = useMemo(() => (loaded ? extractCitations(loaded.text) : []), [loaded]);
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

  // A file let go anywhere but on the box would be opened by the browser in place of the app: refused,
  // over the whole window (the margins and the sidebar too) while the page is open.
  useEffect(() => {
    const refuse = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer || !hasFiles(event) || zoneRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', refuse);
    window.addEventListener('drop', refuse);
    return () => {
      window.removeEventListener('dragover', refuse);
      window.removeEventListener('drop', refuse);
    };
  }, []);

  const handleFile = async (file: File) => {
    const id = ++readingRef.current;
    setError(null);
    setReading(true);
    setSlowReading(false);
    const slow = window.setTimeout(() => { if (id === readingRef.current) setSlowReading(true); }, 200);
    const result = await readDocumentFile(file);
    window.clearTimeout(slow);
    if (id !== readingRef.current) return;
    setReading(false);
    setSlowReading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    focusAfterRef.current = 'result';
    // The box goes from under a file that may still hang over it: no dragleave will come.
    setDragging(false);
    setLoaded({ fileName: file.name, text: result.text });
    setSelected(null);
  };

  const chooseAnother = () => {
    readingRef.current += 1;
    setReading(false);
    setSlowReading(false);
    setDragging(false);
    setError(null);
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

  const onZoneDrag = (event: DragEvent<HTMLButtonElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const onZoneDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const errorBox = error && (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertCircle aria-hidden="true" size={17} className="mt-[3px] shrink-0" />
      <span>{error}</span>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-medium tracking-tight text-slate-900 dark:text-slate-50">Analizza documento</h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">Trova le norme citate in un atto: il file resta nel tuo browser.</p>
        </div>
        <p
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          <ShieldCheck aria-hidden="true" size={14} />
          Resta nel tuo browser<span className="sr-only">: il documento non viene inviato al server né salvato.</span>
        </p>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        data-testid="document-input"
        onChange={event => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ''; }}
      />

      <p className="sr-only" aria-live="polite">{slowReading ? 'Leggo il documento…' : loaded ? countLabel : ''}</p>

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
              <button
                ref={zoneElement}
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={onZoneDrag}
                onDragOver={onZoneDrag}
                onDragLeave={() => setDragging(false)}
                onDrop={onZoneDrop}
                aria-busy={reading || undefined}
                className={cn(
                  'flex min-h-48 w-full flex-col items-center justify-center rounded-[10px] border-2 px-6 py-10 text-center',
                  // Inset: the wrapper that closes upwards clips whatever is drawn outside the box.
                  TRANSITION, FOCUS_RING, 'focus-visible:ring-inset focus-visible:ring-offset-0',
                  dragging
                    ? 'border-solid border-primary-600 bg-primary-50/70 dark:border-primary-400 dark:bg-primary-950/40'
                    : 'border-dashed border-slate-300 bg-white hover:border-primary-400 hover:bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-primary-500 dark:hover:bg-slate-900/70'
                )}
              >
                {/* The children let the drag through, so leaving one is not leaving the box. */}
                <Upload aria-hidden="true" size={28} className={cn('pointer-events-none mb-3', dragging ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400 dark:text-slate-500')} />
                <span className="pointer-events-none font-serif text-xl text-slate-900 dark:text-slate-50">
                  {dragging ? 'Lascia qui il documento' : 'Scegli un documento'}
                </span>
                <span className="pointer-events-none mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                  {dragging ? 'Lo leggo qui, nel tuo browser' : 'o trascinalo qui · TXT, Markdown, HTML o DOCX, fino a 15 MB'}
                </span>
              </button>
              {slowReading && (
                // Shown only if the reading lasts: a small file is read before the line appears.
                <p aria-hidden="true" className="flex items-center gap-2 text-sm text-slate-600 animate-in fade-in duration-200 dark:text-slate-400">
                  <Loader2 size={15} className="motion-safe:animate-spin text-primary-600 dark:text-primary-400" />
                  Leggo il documento…
                </p>
              )}
              {errorBox}
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
    </div>
  );
}
