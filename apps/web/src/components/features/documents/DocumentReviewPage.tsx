/**
 * «Analizza documento»: the norms a document cites (brief D2; design 2026-10-29-document-analysis). The file — or the
 * text pasted in the box — is read here and never sent anywhere; its citations are found in the browser
 * (`documentCandidates.ts`) and read as the search reads them — the client parser first, then `/parse_query_batch` for
 * the query strings it cannot settle, never the text around them (`documentServer.ts`, §6.1); with «Riconosci solo
 * nel browser» on, nothing at all. Each citation opens the reader as a search would (`openCitation`, gotcha 15). The
 * document is drawn as it is, its citations marked in it, and listed beside it by act.
 *
 * PR 3 of #376 and L5 of #391: the user completes by hand what the page could not settle (`CompletionPicker`,
 * `documentReview.ts`), dismisses what is no norm, and — asking `/fetch_norm_links` only on «Prepara i link», with
 * the norms alone — copies the text with its links or downloads a copy of the Word file with them (`LinksPanel`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CloudOff, FileText, Laptop, RotateCcw, ShieldCheck } from 'lucide-react';
import { formatCitationLabel, type CitationMatch } from '../../../utils/citationMatcher';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../ui/Button';
import { FOCUS_RING } from '../../../constants/interactions';
import { dur, ease } from '../../../lib/motion';
import { cn } from '../../../lib/utils';
import { citationCountLabel, groupCitationsByAct } from './citationGroups';
import { CitationList } from './CitationList';
import { DOCUMENT_ACCEPT, readDocumentFile } from './documentFile';
import { DocumentText, type TextMark } from './DocumentText';
import { DropZone, type DropPhase } from './DropZone';
import { DocumentRow, SheetFlight } from './DocumentRow';
import { documentKind, type DocumentJob } from './documentJob';
import { analyseDocument, type DocumentAnalysis } from './documentCandidates';
import { fetchActNames, readOnServer } from './documentServer';
import type { ServerNormReading } from '../../../utils/normQuery';
import { PageFrame } from '../../layout/PageFrame';
import { PasteBox } from './PasteBox';
import { CompletionPicker, type CompletionScope } from './CompletionPicker';
import { LinksPanel, type DownloadReport, type UnlinkedRow } from './LinksPanel';
import {
  DOCX_SKIP_WORDS, NO_LINK_WORDS, applyAct, articleLabel, asMatch, clearAct, hasChoices, linkInputs, listedRows,
  restore, reviewRows, rowsToConfirm, setChoice, snapshot, toCompleteRows,
  type DocumentAct, type ReviewedRow, type RowChoice,
} from './documentReview';
import {
  buildLinkedPaste, copyLinkedPaste, documentLinks, prepareLinks, settleLinks, summarizeLinks,
  type LinkAnswer, type NoLinkReason,
} from './documentLinks';
import { fetchNormLinks } from './documentLinkServer';
import { writeDocxLinksFile } from './docx/docxWriterClient';
import { DocxError } from './docx/docxErrors';
import { showUndoToast } from '../../../hooks/useUndoableAction';
import { notify } from '../../ui/notifications/notifications';
import { FOCUS_RING as RING } from '../../../constants/interactions';

interface LoadedDocument {
  fileName: string;
  text: string;
  /** The file chosen (a DOCX gets a copy with the links), or the text pasted in the box. */
  file: File | null;
  /** Found while the row said «Cerco le citazioni…». */
  analysis: DocumentAnalysis;
  /** The server's answers for this document: «Riprova» asks only for the rest. */
  answers: Map<string, ServerNormReading>;
}

/** The names of the acts, asked once when the page opens (§4.2); null when the server did not answer. */
const askActNames = (signal?: AbortSignal) => fetchActNames(signal).catch((error: unknown) => {
  if (signal?.aborted) return null;
  // Never swallowed (gotcha 18): the page falls back on the client's own names and says so above the list.
  console.error('«Analizza documento»: the catalog of act names did not come', (error as Error)?.message);
  return null;
});

/** «Atto applicato a 4 citazioni» stays this long with «Annulla» (#376 §5.4). */
const APPLY_UNDO_MS = 8000;
/** The title of a text pasted in the box (#391 §5.1). */
const PASTED_TITLE = 'Testo incollato';

/** «art. 2043 c.c.», or «art. 46» for a row with no act. */
const rowLabel = (text: string, row: ReviewedRow) => (row.act ? formatCitationLabel(asMatch(text, row).parsed) : articleLabel(row));

/** «parere.docx» → «parere (con link).docx». */
const copyName = (fileName: string) => `${fileName.replace(/\.docx$/i, '')} (con link).docx`;

/** The badge's words on hover and for a screen reader (#376 §6.4, updated by G-401 for the links). */
const PROMISE_DETAIL = 'Il testo del documento non viene inviato né salvato. Le sole citazioni trovate (per esempio «art. 82 GDPR») vengono riconosciute da VisuaLex, come quando le cerchi; con «Prepara i link» arriva a VisuaLex solo l’elenco delle norme citate, mai il testo.';

/** How long the check stays on the row before the text comes (D6): the time to see it. */
const DONE_MS = 450;
/**
 * A file over the window with no `dragover` for this long has gone: the box rests again. The brief asks about 200 ms;
 * the HTML standard lets a browser send `dragover` only every 350 ms ± 200 while the pointer is still, so a shorter
 * wait could set the box at rest under a file still held over it.
 */
const DRAG_REST_MS = 400;

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
// The window less what stands above the columns (15rem) and the page's foot (`--page-foot`: 2rem, more under the
// feedback button, G8c), so the page itself does not scroll beside the columns.
const COLUMN_HEIGHT = 'lg:h-[calc(100dvh-15rem-var(--page-foot,2rem))] lg:min-h-[24rem]';

export function DocumentReviewPage() {
  const triggerSearch = useAppStore(s => s.triggerSearch);
  const customAliases = useAppStore(s => s.customAliases);
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
  // The names of the acts, asked when the page opens, so a file waits on nothing (§4.2).
  const actNamesRef = useRef<Promise<string[] | null> | null>(null);
  // Aborted when the page goes: an answer then has nowhere to land.
  const pageAbortRef = useRef<AbortController | null>(null);
  // The analysis in flight (a file, or «Riprova»): aborted by the next one, by «Scegli un altro documento» and when the
  // page goes, so a superseded document sends no more chunks.
  const analysisAbortRef = useRef<AbortController | null>(null);

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
  const [retrying, setRetrying] = useState(false);
  // «Riconosci solo nel browser» (#376 §6.3, Q3): off by default, for the page's life only.
  const [localOnly, setLocalOnly] = useState(false);
  // What the user said of the rows, by the row's span: in memory, for this document only (§5.5, Q4).
  const [choices, setChoices] = useState<Map<string, RowChoice>>(() => new Map());
  const [picker, setPicker] = useState<{ index: number; mode: 'complete' | 'change'; anchor: HTMLElement | null } | null>(null);
  // The links (#391 L5): asked only on «Prepara i link», each distinct norm once.
  const [linksPhase, setLinksPhase] = useState<'idle' | 'preparing' | 'ready'>('idle');
  const [linkAnswers, setLinkAnswers] = useState<Map<string, LinkAnswer>>(() => new Map());
  // The first «Prepara i link» has answered: the rows show their links from now on.
  const [prepared, setPrepared] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [report, setReport] = useState<DownloadReport | null>(null);
  const linksAbortRef = useRef<AbortController | null>(null);
  // A row to give the focus once it is drawn in its new place (after «Applica», «Non è una norma», «Ripristina»).
  const focusRowRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    pageAbortRef.current = controller;
    actNamesRef.current = askActNames(controller.signal);
    return () => {
      controller.abort();
      analysisAbortRef.current?.abort();
      linksAbortRef.current?.abort();
    };
  }, []);

  // The choices live in memory: the browser asks before a reload or a closed tab takes them (Q4).
  const unsaved = hasChoices(choices);
  useEffect(() => {
    if (!unsaved) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [unsaved]);

  /** A new analysis: the one before it is aborted. */
  const startAnalysis = useCallback(() => {
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    return controller.signal;
  }, []);

  const rows = useMemo(() => (loaded ? reviewRows(loaded.analysis.citations, choices) : []), [loaded, choices]);
  const listed = useMemo(() => listedRows(rows), [rows]);
  const toComplete = useMemo(() => toCompleteRows(rows).length, [rows]);
  const groups = useMemo(
    () => (loaded ? groupCitationsByAct(loaded.text, listed.map((row) => asMatch(loaded.text, row)), listed.map((row) => row.index)) : []),
    [loaded, listed],
  );
  const countLabel = citationCountLabel(listed.length, groups.length, toComplete);
  const marks = useMemo<TextMark[]>(() => rows
    .filter((row) => !row.dismissed)
    .map((row) => ({ start: row.start, end: row.end, index: row.index, kind: row.origin === 'context' ? 'context' : row.origin === 'incomplete' ? 'incomplete' : 'own' })),
  [rows]);
  // The links, laid over the rows once «Prepara i link» has answered; a new choice needs no request to be drawn.
  const linkIn = useMemo(() => linkInputs(rows, choices), [rows, choices]);
  const links = useMemo(() => (prepared ? settleLinks(linkIn.rows, linkIn.choices, linkAnswers) : null), [prepared, linkIn, linkAnswers]);
  const live = useMemo(() => rows.filter((row) => !row.dismissed), [rows]);
  const summary = useMemo(() => (links ? summarizeLinks(live.map((row) => links[row.index])) : null), [links, live]);
  const unlinked = useMemo(() => {
    if (!links || !loaded) return [];
    const byReason = new Map<NoLinkReason, UnlinkedRow[]>();
    for (const row of live) {
      const link = links[row.index];
      if (!link || link.linked) continue;
      byReason.set(link.reason, [...(byReason.get(link.reason) ?? []), { index: row.index, label: rowLabel(loaded.text, row), reason: NO_LINK_WORDS[link.reason] }]);
    }
    return [...byReason.entries()].map(([reason, list]) => ({ reason, rows: list }));
  }, [links, live, loaded]);
  const waiting = useMemo(() => rowsToConfirm(rows, choices), [rows, choices]);
  const only = useMemo(() => (reviewing ? new Set(waiting.map((row) => row.index)) : null), [reviewing, waiting]);
  const local = loaded ? Boolean(loaded.analysis.local) : localOnly;

  // The row given the focus once it has moved (a completed row joins its act's group).
  useEffect(() => {
    const index = focusRowRef.current;
    if (index === null) return;
    focusRowRef.current = null;
    const target = listBodyRef.current?.querySelector<HTMLElement>(`[data-cite-row="${index}"] button`)
      ?? listBodyRef.current?.querySelector<HTMLElement>('[data-cite-row] button, h3 button');
    target?.focus({ preventScroll: false });
  });

  /**
   * The citations of a text: the names of the acts (asked again if they did not come), then the candidates, the
   * client's readings, the server's for the rest. Never throws: what the server does not answer falls back on the
   * browser (§4.7).
   */
  const analyse = useCallback(async (text: string, signal: AbortSignal, known?: Map<string, ServerNormReading>, onlyHere = false) => {
    if (onlyHere) {
      // Nothing asked, not even the catalog: the client's own names and parser (§6.3).
      return analyseDocument(text, { serverNames: null, customAliases, localOnly: true, ask: async () => ({ answers: new Map(), unanswered: [] }) });
    }
    let names = await (actNamesRef.current ?? askActNames(pageAbortRef.current?.signal));
    if (names === null && known) {
      // «Riprova»: the catalog too, if it was what failed.
      actNamesRef.current = askActNames(pageAbortRef.current?.signal);
      names = await actNamesRef.current;
    }
    // The catalog answers null when the page went while it was asked: nothing more is sent.
    signal.throwIfAborted();
    return analyseDocument(text, {
      serverNames: names,
      customAliases,
      known,
      ask: (queries) => readOnServer(queries, signal),
    });
  }, [customAliases]);

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
  const handleFile = async (file: File, thrown = false, others = 0) => {
    const id = ++readingRef.current;
    const base: DocumentJob = { id, name: file.name, bytes: file.size, kind: documentKind(file.name), stage: 'reading', others };
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
    await findAndShow(base, result.text, file);
  };

  /** A text pasted in the box (#391 §5.1): read as a TXT file is, its row named «Testo incollato». */
  const handleText = async (text: string) => {
    const id = ++readingRef.current;
    const base: DocumentJob = { id, name: PASTED_TITLE, bytes: new TextEncoder().encode(text).length, kind: 'txt', stage: 'searching', others: 0 };
    setJob(base);
    await findAndShow(base, text, null);
  };

  /** The citations of a text read, then the result: the row says «Cerco le citazioni…», the check, then the text. */
  const findAndShow = async (base: DocumentJob, text: string, file: File | null) => {
    const { id } = base;
    setJob({ ...base, stage: 'searching' });
    await nextPaint();
    if (id !== readingRef.current) return;
    const signal = startAnalysis();
    let run: Awaited<ReturnType<typeof analyse>>;
    try {
      run = await analyse(text, signal, undefined, localOnly);
    } catch (error) {
      // An abort: another file, or the page has gone. Anything else is a fault, said on the row and in the console.
      if (signal.aborted || id !== readingRef.current) return;
      console.error('«Analizza documento»: the citations could not be found', error);
      setJob({ ...base, stage: 'error', error: 'Non è stato possibile cercare le citazioni in questo documento.' });
      return;
    }
    if (id !== readingRef.current) return;
    setJob({ ...base, stage: 'done' });
    await new Promise((resolve) => setTimeout(resolve, DONE_MS));
    if (id !== readingRef.current) return;
    focusAfterRef.current = 'result';
    setJob(null);
    setLoaded({ fileName: file?.name ?? PASTED_TITLE, text, file, analysis: run.analysis, answers: run.answers });
    resetReview();
  };

  /** A new document: no choice, no link, no report of the one before. */
  const resetReview = () => {
    setSelected(null);
    setChoices(new Map());
    setPicker(null);
    linksAbortRef.current?.abort();
    setLinksPhase('idle');
    setPrepared(false);
    setLinkAnswers(new Map());
    setReviewing(false);
    setReport(null);
  };

  /**
   * «Riprova»: asks again for what is still unresolved, keeping what the server already answered. `leaveLocal`: the
   * user turned «Riconosci solo nel browser» off for this document. The choices stay where the same citation stands.
   */
  const retry = async (leaveLocal = false) => {
    if (!loaded || retrying) return;
    const id = readingRef.current;
    setRetrying(true);
    if (leaveLocal) setLocalOnly(false);
    const signal = startAnalysis();
    try {
      const run = await analyse(loaded.text, signal, loaded.answers);
      if (id !== readingRef.current) return;
      setLoaded({ ...loaded, analysis: run.analysis, answers: run.answers });
      setSelected(null);
      setPicker(null);
    } catch (error) {
      // An abort: the page or the document has gone. A fault keeps the result as it was, and is said in the console.
      if (!signal.aborted) console.error('«Analizza documento»: «Riprova» failed', error);
    } finally {
      setRetrying(false);
    }
  };
  // The window's listeners (below) live once; the file goes to the handler of the latest render.
  const handleFileRef = useRef(handleFile);
  useEffect(() => {
    handleFileRef.current = handleFile;
  });

  // A file over the window, from `dragover` alone (`dragenter`/`dragleave` fire between children too): over the box or
  // elsewhere, and where on the box; with no event for `DRAG_REST_MS` it has gone. Let go anywhere but on the box, the browser
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
        const x = Math.round(clamp(((event.clientX - (r.left + r.width / 2)) / Math.max(1, r.width)) * 24, 8));
        const y = Math.round(clamp(((event.clientY - (r.top + r.height / 2)) / Math.max(1, r.height)) * 16, 5));
        // A pointer held still sends the same place over and over: no new render for it.
        setLean((was) => (was.x === x && was.y === y ? was : { x, y }));
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
      const files = event.dataTransfer?.files;
      const file = files?.[0];
      // One file at a time: the others are not lost in silence, the row says so.
      if (file) void handleFileRef.current(file, true, Math.max(0, (files?.length ?? 1) - 1));
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
    analysisAbortRef.current?.abort();
    setJob(null);
    zoneRef.current?.focus();
  };

  const chooseAnother = () => {
    readingRef.current += 1;
    analysisAbortRef.current?.abort();
    setJob(null);
    setPhase('idle');
    resetReview();
    focusAfterRef.current = 'zone';
    setLoaded(null);
  };

  // ── The rows: completing, dismissing, confirming (#376 §5; #391 §4.2) ──

  const applyFromPicker = (act: DocumentAct, indices: number[], scope: CompletionScope) => {
    const target = picker?.index ?? indices[0];
    const keys = indices.map((index) => rows[index].key);
    const before = snapshot(choices, keys);
    const own = rows[target].key;
    setPicker(null);
    focusRowRef.current = target;
    // The row in the picker was looked at: it is the user's choice for it. The others were reached in bulk (#391 Q8).
    const next = (current: Map<string, RowChoice>) => {
      let out = applyAct(current, [own], act, 'row');
      if (scope !== 'row') out = applyAct(out, keys.filter((key) => key !== own), act, 'bulk');
      return out;
    };
    void showUndoToast({
      action: () => setChoices(next),
      undo: () => setChoices((current) => restore(current, before)),
      message: keys.length === 1 ? 'Atto applicato a 1 citazione' : `Atto applicato a ${keys.length} citazioni`,
      duration: APPLY_UNDO_MS,
    });
  };

  const changeRow = (index: number, change: Partial<RowChoice>, focus: number | null = index) => {
    focusRowRef.current = focus;
    setChoices((current) => setChoice(current, rows[index].key, change));
  };
  const dismissRow = (index: number) => {
    const pending = toCompleteRows(rows);
    const at = pending.findIndex((row) => row.index === index);
    const next = pending[at + 1] ?? pending[at - 1];
    changeRow(index, { dismissed: true }, next ? next.index : null);
  };
  const uncomplete = (index: number) => {
    focusRowRef.current = index;
    setChoices((current) => clearAct(current, rows[index].key));
  };
  const confirmAll = () => setChoices((current) => {
    let out = current;
    for (const row of waiting) out = setChoice(out, row.key, { confirmed: true });
    return out;
  });
  // Nothing left to review: the list shows all its rows again.
  useEffect(() => {
    if (reviewing && waiting.length === 0) setReviewing(false);
  }, [reviewing, waiting.length]);

  // ── The links (#391 L5) ──

  /** «Prepara i link», and «Riprova»: asks only for the distinct norms with no answer, or one the source left silent. */
  const prepare = async () => {
    if (!loaded || local || linksPhase === 'preparing') return;
    linksAbortRef.current?.abort();
    const controller = new AbortController();
    linksAbortRef.current = controller;
    const was = linksPhase;
    setLinksPhase('preparing');
    try {
      const ready = await prepareLinks(linkIn.rows, {
        choices: linkIn.choices,
        known: linkAnswers,
        retry: true,
        ask: (norms) => fetchNormLinks(norms, controller.signal),
      });
      if (controller.signal.aborted) return;
      setLinkAnswers(ready.answers);
      setPrepared(true);
      setLinksPhase('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('«Analizza documento»: the links could not be prepared', (error as Error)?.message);
      setLinksPhase(was === 'ready' ? 'ready' : 'idle');
      notify({ type: 'error', message: 'Non è stato possibile preparare i link: riprova.', duration: 6000 });
    }
  };

  /** What goes into the copy and the download: exactly the rows «con link» (§4.2). */
  const currentLinks = () => (loaded && links ? documentLinks(loaded.text, linkIn.rows, links) : []);

  const copyWithLinks = async () => {
    if (!loaded || copying) return;
    setCopying(true);
    try {
      const paste = buildLinkedPaste(loaded.text, currentLinks());
      const how = await copyLinkedPaste(paste);
      notify({
        type: 'success',
        message: how === 'rich'
          ? `Testo con ${paste.links} ${paste.links === 1 ? 'link' : 'link'} copiato`
          : 'Testo copiato: i link sono tra parentesi, dopo ogni citazione',
        duration: 4000,
      });
    } catch (error) {
      console.error('«Analizza documento»: the clipboard refused the copy', (error as Error)?.message);
      notify({ type: 'error', message: 'Il browser non mi lascia scrivere negli appunti.', duration: 6000 });
    } finally {
      setCopying(false);
    }
  };

  const downloadCopy = async () => {
    if (!loaded?.file || downloading) return;
    setDownloading(true);
    setReport(null);
    const wanted = currentLinks();
    try {
      const copy = await writeDocxLinksFile({
        file: loaded.file,
        requests: wanted.map(({ start, end, href }) => ({ start, end, href })),
        expectedText: loaded.text,
      });
      const name = copyName(loaded.fileName);
      const blob = new Blob([copy.bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      // The report: every citation left without a link in the copy, and why — the page's reasons and the writer's.
      const skipped: UnlinkedRow[] = unlinked.flatMap((group) => group.rows);
      copy.outcomes.forEach((outcome, at) => {
        if (outcome.linked) return;
        const row = rows[wanted[at].row];
        skipped.push({ index: row.index, label: rowLabel(loaded.text, row), reason: DOCX_SKIP_WORDS[outcome.reason] });
      });
      skipped.sort((a, b) => rows[a.index].start - rows[b.index].start);
      setReport({ ok: true, fileName: name, linked: copy.linked, skipped });
    } catch (error) {
      console.error('«Analizza documento»: the copy with the links could not be written', (error as Error)?.message);
      setReport({
        ok: false,
        error: error instanceof DocxError && error.code === 'signed'
          ? 'Il documento è firmato digitalmente: una copia con i link perderebbe la firma.'
          : 'Non è stato possibile scrivere la copia con i link. Il file originale non è stato toccato.',
      });
    } finally {
      setDownloading(false);
    }
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
      ...(citation.parsed.annex ? { annex: citation.parsed.annex } : {}),
      version: 'vigente',
      version_date: '',
    });
  }, [navigate, triggerSearch]);

  return (
    <PageFrame
      title="Analizza documento"
      line={local
        ? 'Trova le norme citate in un atto. Il riconoscimento è più limitato: VisuaLex non riceve nulla.'
        : 'Trova le norme citate in un atto. Il documento resta sul tuo computer: a VisuaLex arrivano solo le citazioni trovate, come in una ricerca.'}
      action={
        // The promise (#376 §6.4, G-401): what stays, and what goes — said in full on hover and to a screen reader.
        <p
          title={local ? undefined : PROMISE_DETAIL}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {local ? <Laptop aria-hidden="true" size={14} /> : <ShieldCheck aria-hidden="true" size={14} />}
          {local
            ? <>Tutto nel tuo browser<span className="sr-only">: VisuaLex non riceve nulla, né il documento né le citazioni.</span></>
            : <>Il documento resta sul tuo computer<span className="sr-only">. {PROMISE_DETAIL}</span></>}
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

      {/* What happens, said once: «Documento in lettura» (the search for citations is too short to say), «Pronto», a
          refusal, then the count. */}
      <p className="sr-only" aria-live="polite">
        {job?.stage === 'error' ? job.error : job?.stage === 'reading' || job?.stage === 'searching' ? 'Documento in lettura' : job?.stage === 'done' ? 'Pronto' : loaded ? countLabel : ''}
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
            {/* Positioned: a row that leaves while another comes is laid over it (`popLayout`). */}
            <div className="relative flex flex-col gap-3 pb-1">
              {/* The box and the paste side by side on a computer, the paste under the box on a phone (#391 §5.1). */}
              <div className="grid gap-3 lg:grid-cols-2">
              <DropZone
                ref={zoneElement}
                phase={phase}
                lean={lean}
                landings={landings}
                touch={touch}
                busy={job !== null && job.stage !== 'error'}
                onChoose={() => fileInputRef.current?.click()}
                sheetRef={sheetRef}
                flying={flight !== null}
              />
              <PasteBox busy={job !== null && job.stage !== 'error'} onAnalyse={(text) => void handleText(text)} />
              </div>
              <LocalSwitch on={localOnly} onChange={setLocalOnly} />
              {/* The document's row; a refusal slides away with its ✕. A new row takes the old one's place at once
                  (`popLayout`), so the sheet thrown to it lands where it stays. */}
              <AnimatePresence initial={false} mode="popLayout">
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
            <LinksPanel
              localOnly={local}
              onLeaveLocal={() => void retry(true)}
              phase={prepared ? 'ready' : linksPhase === 'preparing' ? 'preparing' : 'idle'}
              refreshing={prepared && linksPhase === 'preparing'}
              summary={summary}
              unlinked={unlinked}
              toConfirm={waiting.length}
              reviewing={reviewing}
              onReview={setReviewing}
              onConfirmAll={confirmAll}
              onPrepare={() => void prepare()}
              onCopy={() => void copyWithLinks()}
              copying={copying}
              docx={Boolean(loaded.file && /\.docx$/i.test(loaded.fileName))}
              onDownload={() => void downloadCopy()}
              downloading={downloading}
              report={report}
              onSelect={selectFromList}
            />
            {/* Citations first in the order of reading (a phone shows them above the text); on a computer
                the text takes the left column. */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
              <aside aria-labelledby="doc-citations" className={cn(PANEL, COLUMN_HEIGHT, 'max-h-[55dvh] lg:col-start-2 lg:row-start-1 lg:max-h-none')}>
                <h2 id="doc-citations" className={PANEL_HEAD}>Citazioni</h2>
                {loaded.analysis.degraded && (
                  <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                    <CloudOff aria-hidden="true" size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                    <p className="min-w-0 flex-1 basis-48">VisuaLex non risponde: ho riconosciuto solo le forme che conosco nel browser.</p>
                    <Button variant="secondary" size="sm" loading={retrying} onClick={() => void retry()} className="md:min-h-11">Riprova</Button>
                  </div>
                )}
                {reviewing && (
                  <p role="status" className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                    Mostro le citazioni da confermare.{' '}
                    <button type="button" onClick={() => setReviewing(false)} className={cn('font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300', RING)}>Mostra tutte</button>
                  </p>
                )}
                <div ref={listBodyRef} className={PANEL_BODY}>
                  <CitationList
                    text={loaded.text}
                    rows={rows}
                    groups={groups}
                    selected={selected}
                    choices={choices}
                    links={links}
                    linksOn={prepared}
                    only={only}
                    onSelect={selectFromList}
                    onOpen={openCitation}
                    onPick={(index, mode, anchor) => setPicker({ index, mode, anchor })}
                    onDismiss={dismissRow}
                    onRestore={(index) => changeRow(index, { dismissed: false })}
                    onUncomplete={uncomplete}
                    onConfirm={(index) => changeRow(index, { confirmed: true })}
                    onLeaveOut={(index, leftOut) => changeRow(index, { leftOut })}
                  />
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
                  <DocumentText text={loaded.text} marks={marks} selected={selected} onSelect={selectFromText} />
                </div>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {flight && <SheetFlight key={landings} from={flight} target={markRef} onDone={() => setFlight(null)} />}
      {loaded && picker && rows[picker.index] && (
        <CompletionPicker
          text={loaded.text}
          row={rows[picker.index]}
          rows={rows}
          analysis={loaded.analysis}
          mode={picker.mode}
          localOnly={local}
          customAliases={customAliases}
          anchor={picker.anchor}
          onApply={applyFromPicker}
          onClose={() => setPicker(null)}
        />
      )}
    </PageFrame>
  );
}

/**
 * «Riconosci solo nel browser» (#376 §6.3, Q3): off by default. On, nothing about the document leaves the computer —
 * not even the citations — the recognition is the browser's own, and no link can be asked (#391 §8).
 */
function LocalSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby="doc-local-hint"
        onClick={() => onChange(!on)}
        className={cn('inline-flex min-h-11 items-center gap-2.5 rounded-lg pr-2 text-sm font-medium text-slate-800 dark:text-slate-200', RING)}
      >
        <span aria-hidden="true" className={cn('relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors motion-reduce:transition-none', on ? 'bg-primary-600 dark:bg-primary-500' : 'bg-slate-300 dark:bg-slate-600')}>
          <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] motion-reduce:transition-none', on ? 'left-[1.125rem]' : 'left-0.5')} />
        </span>
        Riconosci solo nel browser
      </button>
      <p id="doc-local-hint" className="min-w-0 flex-1 basis-64 text-[13px] leading-snug text-slate-600 dark:text-slate-400">
        {on
          ? 'Il riconoscimento è più limitato: VisuaLex non riceve nulla, e i link non si possono inserire.'
          : 'Per un documento riservato: nemmeno le citazioni trovate arrivano a VisuaLex.'}
      </p>
    </div>
  );
}
