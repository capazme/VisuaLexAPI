import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Download, EyeOff, Loader2, Maximize2, Network, Upload, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { SearchParams } from '../../../../types';
import { useAppStore } from '../../../../store/useAppStore';
import { isMerltGraphEnabled } from '../featureFlag';
import { useMerltFeatures } from '../../useMerltFeatures';
import { useQaThread } from '../../qa/useQaThread';
import { sendRelationFeedback } from '../../qa/qaApi';
import type { GraphContext, GraphTraversalEdge, QaMode, QaPrefillState, QaRetrievedSource } from '../../qa/types';
import { useArticleGraph } from '../shared/useArticleGraph';
import { mergeElements, type GraphElements } from '../shared/graphTransform';
import {
  buildDeliberationOverlay,
  canonKeyFromNodeId,
  CANON_STYLE,
  isDeliberationElementId,
  readDeliberation,
  resolveEdgeSelection,
  withDeliberationOverlay,
} from '../shared/graphDeliberation';
import { CONTRAST_ARC_COLOR } from '../shared/graphStyles';
import {
  CANON_KEYS,
  type CanonKey,
  type DisagreementConflict,
  type ExpertContribution,
  type GraphEdge,
  type GraphEdgeSelection,
} from '../shared/types';
import { CANON_LABEL, formatRetrievedUrn, sourceLabel } from '../../qa/format';
import { MAX_EMPTY_STATE_SOURCES, pickEmptyStateSources } from './emptyStateSources';
import { resolveLocalSourceNode } from './sourceGraphLink';
import {
  clampColumnWidth,
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  COLUMN_WIDTH_STORAGE_KEY,
  readStoredColumnWidth,
} from './columnWidth';
import {
  buildSnapshot,
  parseSnapshot,
  downloadSnapshot,
  SnapshotParseError,
  type GraphSliceSnapshot,
} from '../shared/snapshotIO';
import { useIngestionJob } from '../shared/useIngestionJob';
import {
  classifyIngestionTriggerError,
  defaultGraphDepth,
  fetchNodeNeighborhood,
  PAGE_GRAPH_LIMIT_DEFAULT,
  triggerIngestion,
  type IngestionTriggerErrorKind,
} from '../shared/graphApi';
import type { GraphNode, GraphSearchItem } from '../shared/types';
import type { GraphCanvasHandle, GraphLayoutName } from '../shared/GraphCanvas';
import { Toast } from '../../../../components/ui/Toast';
import { computeTypeCounts } from '../shared/graphFilters';
import { GraphSearchBox } from './GraphSearchBox';
import { GraphTruncationChip } from './GraphTruncationChip';
import { AskGraphField, type ContextChip } from './AskGraphField';
import { DeliberationColumn } from './DeliberationColumn';
import { GraphTraversalPlayer } from './GraphTraversalPlayer';
import { ConsentDialog } from '../../consent/ConsentDialog';
import { BreadcrumbHistory } from './BreadcrumbHistory';
import { DepthSelector } from './DepthSelector';
import { GraphFilterPanel } from './GraphFilterPanel';
import { LAYOUT_OPTIONS } from './graphLayouts';
import { useBreadcrumbHistory } from './useBreadcrumbHistory';
import { isArticleCenter, resolveCenterNodeId } from './graphCenter';

const GraphCanvas = lazy(() => import('../shared/GraphCanvas'));

/**
 * Node types that carry case-law density (the ~10k `AttoGiudiziario` sentenze +
 * `Caso`). "Nascondi giurisprudenza" toggles these (design §4/§8 — the one real
 * legibility lever), default-on while a deliberation is active.
 */
const JURISPRUDENCE_TYPES: readonly string[] = ['AttoGiudiziario', 'Caso'];

/** F2: hard node budget for the merged view — beyond it, expansion refuses. */
const MAX_GRAPH_NODES = 300;
/** F2: edge budget of a single expand-in-place fetch (depth 1 around a node). */
const EXPAND_FETCH_LIMIT = 40;

/** F2: accumulated expand-in-place delta (RAW BFF shapes, deduped on append). */
interface ExpansionDelta {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
const EMPTY_EXPANSION: ExpansionDelta = { nodes: [], edges: [] };
const EMPTY_ELEMENTS: GraphElements = { nodes: [], edges: [] };

/** Nodes-as-context: cap on the question's context basket (keeps the prompt focused). */
const MAX_CONTEXT_ITEMS = 8;

/**
 * One node pinned to the question's context basket. `kind` routes it to the
 * MERL-T channel: Norma nodes → `norm_references` (their graph urn), everything
 * else → `legal_concepts` (their label). `id` is the graph node id (dedup key).
 */
interface ContextItem {
  id: string;
  label: string;
  kind: 'norm' | 'concept';
  ref: string;
}

/** Basket item for a graph node (Norma → norm ref, else concept by label). */
function toContextItem(node: GraphNode): ContextItem {
  const isNorm = Boolean(node.urn);
  return {
    id: node.id,
    label: node.label,
    kind: isNorm ? 'norm' : 'concept',
    ref: isNorm ? stripVersionMarker(node.urn as string) : node.label,
  };
}

/**
 * Seed item for the current center, built from the URL (no GraphNode needed).
 * When the center is a not-yet-indexed article (a deeplink with no breadcrumb
 * label), the caller's label falls back to the raw urn — derive a readable
 * "art. N" from it instead of showing the full Normattiva URL on the chip. The
 * `ref` (sent to MERL-T) always stays the urn/label, unaffected by the display.
 */
function centerContextItem(urn: string, label: string | undefined, isArticle: boolean): ContextItem {
  const display = label && label !== urn ? label : formatRetrievedUrn(urn);
  return {
    id: urn,
    label: display,
    kind: isArticle ? 'norm' : 'concept',
    ref: isArticle ? stripVersionMarker(urn) : display,
  };
}

/** Map the basket to the MERL-T-bound context (norm urns + concept labels). */
function basketToContext(items: ContextItem[]): GraphContext | undefined {
  const normReferences = items.filter((i) => i.kind === 'norm').map((i) => i.ref);
  const legalConcepts = items.filter((i) => i.kind === 'concept').map((i) => i.ref);
  if (normReferences.length === 0 && legalConcepts.length === 0) return undefined;
  return {
    ...(normReferences.length ? { normReferences } : {}),
    ...(legalConcepts.length ? { legalConcepts } : {}),
  };
}

// URL-as-SoT: `?depth=` is always the override; `fallback` is only the default
// when the param is absent (payload diet: 2 for article centers, 1 for concepts).
function clampDepth(raw: string | null, fallback: number): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(3, Math.max(1, n));
}

function parseLayout(raw: string | null): GraphLayoutName {
  const allowed = LAYOUT_OPTIONS.map((o) => o.value);
  return allowed.includes(raw as GraphLayoutName) ? (raw as GraphLayoutName) : 'force';
}

/**
 * Full-canvas knowledge-graph explorer at /grafo. Slice 2a-2 builds this up
 * story by story; 2a.8 ships the skeleton: query-param driven fetch, canvas,
 * empty/loading/error states, and a right column reserved for the node drawer
 * (2a.10). The search box (2a.9), depth/layout controls (2a.11) and breadcrumb
 * (2a.10) mount into the reserved regions later.
 */
export function GraphExplorerPage(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);
  const enabled = isMerltGraphEnabled();
  const { qaAskable, canContribute } = useMerltFeatures();
  const urn = searchParams.get('urn');
  const centerType = searchParams.get('type'); // C1: threaded so it survives refresh/deeplink
  // C2: only Norma/article centers are lazy-ingestable; concepts are not.
  const centerIsArticle = isArticleCenter(centerType, urn);
  // Payload diet (Wave 2): concept centers default to depth 1 (a hub concept at
  // depth 2 is a hairball); articles keep 2. `?depth=` always overrides.
  const depth = clampDepth(searchParams.get('depth'), defaultGraphDepth(centerIsArticle));
  const layout = parseLayout(searchParams.get('layout'));
  // F4: page edge budget, bumped by the truncation chip's "Carica di più"
  // ladder (25→50→100→200). Part of the SWR cache key → a bump refetches.
  const [limit, setLimit] = useState<number>(PAGE_GRAPH_LIMIT_DEFAULT);
  // Hooks must run unconditionally; pass null urn when disabled so no fetch fires.
  const graph = useArticleGraph(enabled ? urn : null, depth, limit);
  const { entries, push } = useBreadcrumbHistory();

  // Human label of the current center → drives the AskGraphField basket seed and
  // the scope chip. Computed up here so the basket seed below can read it.
  const centerLabel = urn ? labelFor(urn, entries) : undefined;

  // Nodes-as-context: the question's context basket. Seeded with the current
  // center on every center change (a new center = a new focus), then mutated by
  // "Usa come contesto" in the node drawer. Reset via the derive-during-render
  // tracked-prop pattern (gotcha #11) — never a synchronous in-effect setState.
  const [contextBasket, setContextBasket] = useState<ContextItem[]>(() =>
    urn ? [centerContextItem(urn, centerLabel, centerIsArticle)] : [],
  );
  const [trackedCenterForBasket, setTrackedCenterForBasket] = useState<string | null>(urn);
  if (urn !== trackedCenterForBasket) {
    setTrackedCenterForBasket(urn);
    setContextBasket(urn ? [centerContextItem(urn, centerLabel, centerIsArticle)] : []);
  }

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Slice 4 P2a: a clicked edge (real relation or synthetic contrast arc). Lives
  // beside the node selection; a node click clears it and vice versa so the Nodo
  // tab shows exactly one inspection target.
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeSelection | null>(null);
  // F3: the CANVAS id of the selected edge (real OR synthetic) — the controlled
  // 'selected' state the canvas paints. Kept beside selectedEdge because the
  // resolved GraphEdgeSelection does not carry the synthetic arc id.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // F3: one clearing gesture for both brains — React state here, G6 'selected'
  // state via the controlled selectedNodeId/selectedEdgeId props.
  const clearGraphSelection = useCallback((): void => {
    setSelectedNodeId(null);
    setSelectedEdge(null);
    setSelectedEdgeId(null);
  }, []);

  // F2: expand-in-place state — accumulated delta, per-node "already expanded"
  // guard, the node whose fetch is in flight (pulsed on canvas), and an epoch
  // that invalidates in-flight expansions when the center changes.
  const [expansion, setExpansion] = useState<ExpansionDelta>(EMPTY_EXPANSION);
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingExpandId, setPendingExpandId] = useState<string | null>(null);
  const expandEpochRef = useRef(0);

  // Slice 4 P1: the page OWNS the Q&A thread (useQaThread lifted here); the
  // header field + deliberation column are presentational and receive turns +
  // handlers. `ask`/`retry`/`cancel` are stable callbacks (useCallback in the
  // hook), so passing them down does not thrash the column.
  const qa = useQaThread();
  // MARQUEE feature: "Segui il ragionamento sul grafo" — which turn's walk (if
  // any) is being replayed on the MAIN canvas. Lifted here (not in
  // DeliberationColumn) because the replay takes over the main region, not the
  // column — the column only holds the trigger button. Only one walk active at
  // a time: activating a new turn's walk replaces whatever was showing.
  const [activeWalk, setActiveWalk] = useState<GraphTraversalEdge[] | null>(null);
  // Deliberation column tab: 'dibattito' after an ask, 'nodo' after a node click.
  const [activeTab, setActiveTab] = useState<'dibattito' | 'nodo'>('dibattito');
  // Defect #4: a turn that settles while the user is on the Nodo tab pulses the
  // Dibattito tab. Cleared the moment the tab is opened (see switchTab).
  const [dibattitoBadge, setDibattitoBadge] = useState(false);
  const switchTab = useCallback((tab: 'dibattito' | 'nodo'): void => {
    setActiveTab(tab);
    if (tab === 'dibattito') setDibattitoBadge(false);
  }, []);
  // Defect #10: the deliberation is SCOPED to the center it was asked on —
  // recorded at ask time. When the user recenters elsewhere, the overlay /
  // source highlight / steer channels switch off and a "torna" chip appears.
  const [askScope, setAskScope] = useState<{ urn: string; label: string; type: string | null } | null>(null);
  // Defect #5: a canon-star click on canvas routes to the Dibattito tab and
  // expands that canon's thesis; the nonce re-arms a repeat click.
  const [canonFocus, setCanonFocus] = useState<{ key: CanonKey; nonce: number } | null>(null);
  // P1.9: "× evidenza fonti" — the user dismissed the sources emphasis for the
  // current deliberation; re-armed when a new answer (new sources) settles.
  const [sourceFadeDismissed, setSourceFadeDismissed] = useState(false);
  // P1.7: imperative handle into the canvas for "Adatta alla vista".
  const canvasRef = useRef<GraphCanvasHandle | null>(null);

  // Wave 2 UX: the docked deliberation column collapses to a thin rail to reclaim
  // canvas width. Persisted so the preference survives reloads. Single-composer
  // rule (design decision): when collapsed the header "Chiedi al grafo" field
  // re-appears (the column's own composer is hidden with the column); any gesture
  // that produces column content — asking, or inspecting a node/edge — re-expands
  // it so the result is never hidden behind the rail.
  const [columnCollapsed, setColumnCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('merlt-grafo-column-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const setColumnCollapsedPersist = useCallback((next: boolean): void => {
    setColumnCollapsed(next);
    try {
      localStorage.setItem('merlt-grafo-column-collapsed', next ? '1' : '0');
    } catch {
      /* private mode — the preference just won't persist */
    }
  }, []);
  const revealColumn = useCallback((): void => {
    setColumnCollapsedPersist(false);
  }, [setColumnCollapsedPersist]);
  const toggleColumnCollapsed = useCallback((): void => {
    const next = !columnCollapsed;
    setColumnCollapsedPersist(next);
    // Expanding = the jurist is looking at the debate again → clear the pulse.
    if (!next) setDibattitoBadge(false);
  }, [columnCollapsed, setColumnCollapsedPersist]);

  // Audit item 4: the docked column's width is a draggable splitter, clamped to
  // [COLUMN_WIDTH_MIN, COLUMN_WIDTH_MAX] and persisted the same way the collapse
  // preference is. `isResizingColumn` drops the width transition WHILE dragging
  // (the CSS transition would otherwise lag every mousemove) and re-enables it
  // once the drag ends.
  const [columnWidth, setColumnWidth] = useState<number>(() => readStoredColumnWidth());
  const [isResizingColumn, setIsResizingColumn] = useState(false);
  const columnDragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => columnDragCleanupRef.current?.(), []);
  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = columnWidth;
      let latestWidth = startWidth;
      setIsResizingColumn(true);
      const onMove = (ev: MouseEvent): void => {
        const delta = ev.clientX - startX; // splitter sits LEFT of the column: moving left widens it
        latestWidth = clampColumnWidth(startWidth - delta);
        setColumnWidth(latestWidth);
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        columnDragCleanupRef.current = null;
        setIsResizingColumn(false);
        try {
          localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, String(latestWidth));
        } catch {
          /* private mode — the preference just won't persist */
        }
      };
      columnDragCleanupRef.current = onUp;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [columnWidth],
  );
  const persistColumnWidth = useCallback((next: number): void => {
    setColumnWidth(next);
    try {
      localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, String(next));
    } catch {
      /* private mode — the preference just won't persist */
    }
  }, []);
  const handleSplitterKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.target !== e.currentTarget) return;
      // Splitter sits LEFT of the column: ArrowLeft widens it, ArrowRight narrows it.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        persistColumnWidth(clampColumnWidth(columnWidth + 16));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        persistColumnWidth(clampColumnWidth(columnWidth - 16));
      }
    },
    [columnWidth, persistColumnWidth],
  );

  // Defect #4, derived during render (react-hooks/set-state-in-effect): when the
  // count of SETTLED turns grows while the Nodo tab is active, light the badge.
  // 'partial' (async progressive Q&A) is still in-flight, not settled.
  const settledCount = qa.turns.filter((t) => t.state.status === 'success' || t.state.status === 'error').length;
  const [seenSettledCount, setSeenSettledCount] = useState(settledCount);
  if (settledCount !== seenSettledCount) {
    setSeenSettledCount(settledCount);
    // Pulse when the answer landed unseen: on the Nodo tab, OR while the whole
    // column was collapsed (the rail carries the same pulse dot).
    if (settledCount > seenSettledCount && (activeTab === 'nodo' || columnCollapsed))
      setDibattitoBadge(true);
  }
  // Slice 4 P2b (§5 L2): the "pesa di più questo canone" upsell opens the consent
  // dialog when the jurist lacks full consent. Hosted here so the steer control can
  // route users to grant `full` without leaving the deliberation.
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  // "Nascondi giurisprudenza" (design §4/§8). User-controllable primary toggle;
  // default-on is derived (see hideJurisprudence below) while a debate is active.
  const [hideJurisManual, setHideJurisManual] = useState<boolean | null>(null);

  // Lazy ingestion: a urn that resolves to an empty subgraph isn't in the graph
  // yet — enqueue an ingestion job, poll it, then refetch when it completes.
  const [jobId, setJobId] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<IngestionTriggerErrorKind | null>(null);
  const job = useIngestionJob(jobId);
  const triggeredRef = useRef(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Filtering / legend state (client-side, no refetch — hides via G6 visibility).
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<ReadonlySet<string>>(new Set());
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<ReadonlySet<string>>(new Set());
  const [highlightType, setHighlightType] = useState<string | null>(null);
  // #7: local graph-slice snapshot (the server does not host personal graphs).
  const [importedSlice, setImportedSlice] = useState<GraphSliceSnapshot | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset per-graph state when the CENTER (urn) changes — not on depth/layout —
  // so filters/highlight don't bleed across different entities.
  useEffect(() => {
    triggeredRef.current = false;
    setJobId(null);
    setTriggerError(null);
    setHiddenNodeTypes(new Set());
    setHiddenEdgeTypes(new Set());
    setHighlightType(null);
    setSelectedEdge(null);
    setSelectedEdgeId(null);
    // Re-arm the derived default for "nascondi giurisprudenza" on the new center.
    setHideJurisManual(null);
    // F4: the "Carica di più" ladder is per-center — a new center starts back
    // at the default budget.
    setLimit(PAGE_GRAPH_LIMIT_DEFAULT);
    // F2: expansions belong to the center they were made on — a new center
    // starts clean, and the epoch bump discards any in-flight expansion fetch.
    expandEpochRef.current += 1;
    setExpansion(EMPTY_EXPANSION);
    setExpandedNodeIds(new Set());
    setPendingExpandId(null);
  }, [urn]);

  // QA-PREFILL CONTRACT (qa/types.ts): the in-article "Chiedi su questo articolo"
  // navigates here with a QaPrefillState in location.state (+ ?urn= to center).
  // Consume it exactly once — fire the ask, switch to the Dibattito tab, and
  // clear location.state via replace so a manual reload does not re-ask.
  const prefillConsumedRef = useRef(false);
  useEffect(() => {
    if (prefillConsumedRef.current) return;
    const state = location.state as QaPrefillState | null;
    if (!state?.prefillQuery) return;
    // F4: only CONSUME (fire + strip) when asking is unlocked. When !qaAskable the
    // ask would be silently dropped, so leave location.state intact instead —
    // once consent is granted (qaAskable flips true) this effect re-runs on the
    // same state and the question is asked, never lost. The disabled AskGraphField
    // already surfaces the "serve il consenso base" hint in the meantime.
    if (!qaAskable) {
      switchTab('dibattito');
      return;
    }
    prefillConsumedRef.current = true;
    // Defect #10: the prefilled ask is scoped to the article it came from.
    setAskScope(urn ? { urn, label: state.articleHeading ?? urn, type: centerType } : null);
    switchTab('dibattito');
    // The prefill always travels WITH its article as context (a Norma → the
    // norm_references channel; a concept center → legal_concepts).
    const prefillContext: GraphContext | undefined = urn
      ? centerIsArticle
        ? { normReferences: [stripVersionMarker(urn)] }
        : { legalConcepts: [state.articleHeading ?? urn] }
      : undefined;
    void qa.ask(state.prefillQuery, 'convergent', prefillContext ? { context: prefillContext } : undefined);
    // Strip the consumed prefill from history so reload / back does not re-fire it.
    navigate(location.pathname + location.search, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, qaAskable]);

  // P1.7: global Esc — deselect node/edge and close the inspection drawer (the
  // Nodo tab flips back to the debate). Ignored while typing in a field and while
  // the consent dialog is open (it owns its own dismissal). F3: the controlled
  // selection props propagate the clear to the G6 'selected' state too.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || consentDialogOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      clearGraphSelection();
      switchTab('dibattito');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [consentDialogOpen, switchTab, clearGraphSelection]);

  useEffect(() => {
    if (graph.status !== 'success' || graph.data.nodes.length > 0) return;
    if (triggeredRef.current || !urn) return;
    // C2: a concept with an empty subgraph is "not connected", NOT an article to
    // ingest — never enqueue ingestion for it (would spin forever, then wrongly
    // claim "Articolo non indicizzabile").
    if (!centerIsArticle) return;
    triggeredRef.current = true;
    triggerIngestion(urn)
      .then((r) => setJobId(r.jobId))
      .catch((err: unknown) => setTriggerError(classifyIngestionTriggerError(err)));
    // Keyed on status (data is undefined outside success; read at fire time;
    // triggeredRef guards re-entry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.status, urn, centerIsArticle]);

  // Full machine reset: re-arm the trigger and refetch — an empty subgraph
  // then re-enqueues the ingestion (with a fresh polling budget).
  const retryIngestion = (): void => {
    triggeredRef.current = false;
    setJobId(null);
    setTriggerError(null);
    graph.refetch();
  };

  useEffect(() => {
    if (job.status === 'completed') {
      setToast({ message: 'Grafo aggiornato', type: 'success' });
      graph.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.status]);

  // Seed the breadcrumb on any urn change — including a direct deeplink, where
  // goToCenter never runs. push() dedupes the current urn, so this is a no-op
  // right after an in-page navigation already pushed a richer label.
  useEffect(() => {
    if (urn) push({ urn, label: labelFor(urn, entries) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urn]);

  // `useArticleGraph` returns a FRESH object every render (`{ ...state, refetch }`),
  // so keying memos on `graph` never actually memoizes. Key on the per-fetch
  // stable payload instead: `data`/`elements` are only new references when a
  // fetch settles, so the derived joins below stay reference-stable between
  // renders that don't refetch. (`graphData`/`graphElements` are `undefined`
  // outside the data-bearing branches — a stable sentinel the memos treat as
  // "empty".) F1: 'revalidating' carries the PREVIOUS graph — the canvas keeps
  // rendering it under a veil while the new center loads (no skeleton swap).
  const graphHasData = graph.status === 'success' || graph.status === 'revalidating';
  const graphData = graphHasData ? graph.data : undefined;
  const graphElements = graphHasData ? graph.elements : undefined;
  // F2: the VIEW = base subgraph + accumulated expansion delta, deduped by id
  // (base wins, so a revalidation refresh never duplicates an expanded node).
  // Reference-stable: with no expansion the base arrays pass through untouched.
  const baseNodes = graphData?.nodes;
  const baseEdges = graphData?.edges;
  const nodes = useMemo<GraphNode[]>(() => {
    const base = baseNodes ?? [];
    if (expansion.nodes.length === 0) return base;
    const seen = new Set(base.map((n) => n.id));
    const extra = expansion.nodes.filter((n) => !seen.has(n.id));
    return extra.length > 0 ? [...base, ...extra] : base;
  }, [baseNodes, expansion]);
  const edges = useMemo<GraphEdge[]>(() => {
    const base = baseEdges ?? [];
    if (expansion.edges.length === 0) return base;
    const nodeIds = new Set(nodes.map((n) => n.id));
    const seen = new Set(base.map(rawEdgeKey));
    const extra = expansion.edges.filter(
      (e) => !seen.has(rawEdgeKey(e)) && nodeIds.has(e.source) && nodeIds.has(e.target)
    );
    return extra.length > 0 ? [...base, ...extra] : base;
  }, [baseEdges, expansion, nodes]);
  const nodesById = useMemo(() => new Map<string, GraphNode>(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  // F2: latest merged ids for the ASYNC expand handler (a closure over `nodes`
  // could be stale by the time the fetch settles). Synced in an effect.
  const mergedIdsRef = useRef<{ nodes: ReadonlySet<string>; edges: ReadonlySet<string> }>({
    nodes: new Set(),
    edges: new Set(),
  });
  useEffect(() => {
    mergedIdsRef.current = {
      nodes: new Set(nodes.map((n) => n.id)),
      edges: new Set(edges.map(rawEdgeKey)),
    };
  }, [nodes, edges]);

  // Defect #10: does the CURRENT center match the center recorded at ask time?
  // An unscoped ask (no center at ask time, or a legacy thread) always matches.
  // Version markers are stripped on both sides (gotcha #6) so `!vig=` variants
  // of the same article stay in scope.
  const scopeMatches =
    askScope === null ||
    (urn !== null && stripVersionMarker(askScope.urn) === stripVersionMarker(urn));

  // The most recent successful deliberation drives the sources-as-nodes highlight
  // (design §3.2). Sources present in the current subgraph light up on canvas; the
  // rest stay listed as chips in the column. Pure FE join — no missing node added.
  const latestSources = useMemo<QaRetrievedSource[]>(() => {
    for (let i = qa.turns.length - 1; i >= 0; i -= 1) {
      const t = qa.turns[i];
      if (t.state.status === 'success') return t.state.answer.retrieved_sources;
    }
    return [];
  }, [qa.turns]);

  // P1.9: re-arm the dismissed sources emphasis when a NEW answer settles (the
  // memo above hands back a fresh reference only when the turns change).
  // Derived during render — no set-state-in-effect.
  const [trackedSources, setTrackedSources] = useState<QaRetrievedSource[]>(latestSources);
  if (latestSources !== trackedSources) {
    setTrackedSources(latestSources);
    if (sourceFadeDismissed) setSourceFadeDismissed(false);
  }

  // Is there an active/pending deliberation ON THIS CENTER? Drives the "nascondi
  // giurisprudenza" default-on. True the moment the first turn appears, but only
  // while the current center matches the deliberation's scope (defect #10).
  const hasDeliberation = qa.turns.length > 0 && scopeMatches;

  // Slice 4 P2a — the debate overlay reflects ONLY the LATEST turn's answer.
  // Async progressive Q&A (qa-async-progressive-contract.md): a 'partial' turn
  // lights up the canvas progressively too — `readDeliberation` reads a plain
  // `expert_contributions` field structurally, so a synthetic `{
  // expert_contributions: partials }` shape feeds the SAME overlay pipeline as
  // a settled answer WITHOUT synthesis/dissent/confidence (those stay
  // terminal-only per the contract — `readDeliberation` never sees them here,
  // since the synthetic object carries nothing else). A new ask (newest turn →
  // loading) or a failed turn clears the overlay, so synthetic canon/contrast
  // elements never linger over a stale in-flight deliberation (lifecycle: §3).
  const latestAnswer = useMemo<unknown>(() => {
    const last = qa.turns[qa.turns.length - 1];
    if (!last) return null;
    if (last.state.status === 'success') return last.state.answer;
    if (last.state.status === 'partial') return { expert_contributions: last.state.partials };
    return null;
  }, [qa.turns]);

  // Slice 4 L3 — the LATEST settled deliberation's trace_id: the handle every
  // relation steer attaches to. Same lifecycle as the overlay (an in-flight or
  // failed newest turn clears it), so the edge steer control hides exactly when
  // there is no current deliberation to teach against.
  const latestTraceId = useMemo<string | null>(() => {
    if (!scopeMatches) return null; // defect #10: steering is scoped to its center
    const last = qa.turns[qa.turns.length - 1];
    return last?.state.status === 'success' && last.state.answer.trace_id
      ? last.state.answer.trace_id
      : null;
  }, [qa.turns, scopeMatches]);

  const deliberation = useMemo(() => readDeliberation(latestAnswer), [latestAnswer]);
  const expertContributions = useMemo<ExpertContribution[]>(
    () => deliberation.expert_contributions ?? [],
    [deliberation],
  );
  const conflicts = useMemo<DisagreementConflict[]>(
    () => deliberation.disagreement_analysis?.conflicts ?? [],
    [deliberation],
  );
  const devilsAdvocateActive = deliberation.devils_advocate_flag?.active === true;
  // Scope the badge/arc marker to the specific canon MERL-T names (Slice 4
  // gap-closure — the flag now carries `expert`); undefined falls back to the
  // pre-attribution global marker in both buildDeliberationOverlay and
  // resolveEdgeSelection.
  const devilsAdvocateExpert = deliberation.devils_advocate_flag?.expert ?? null;

  // Join retrieved_sources to canvas node ids: a source lands on the graph iff its
  // node_id (preferred) OR urn matches a node id/urn currently rendered. Uses the
  // TRANSFORMED elements' ids (same id space the canvas highlights on).
  const sourceHighlightIds = useMemo<ReadonlySet<string> | null>(() => {
    if (!scopeMatches || latestSources.length === 0) return null;
    const byUrn = new Map<string, string>();
    for (const n of nodes) if (n.urn) byUrn.set(n.urn, n.id);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const hit = new Set<string>();
    for (const s of latestSources) {
      if (s.node_id && nodeIds.has(s.node_id)) hit.add(s.node_id);
      else if (byUrn.has(s.urn)) hit.add(byUrn.get(s.urn)!);
    }
    return hit.size > 0 ? hit : null;
  }, [latestSources, nodes, scopeMatches]);

  // P1.9: the emphasis actually sent to the canvas — the "× evidenza fonti" chip
  // clears it without losing the underlying join (a new answer re-arms it).
  const effectiveSourceHighlightIds = sourceFadeDismissed ? null : sourceHighlightIds;

  // "Nascondi giurisprudenza": manual override wins; otherwise default-on while a
  // deliberation is active (density mitigation), off in plain exploration.
  const hideJurisprudence = hideJurisManual ?? hasDeliberation;


  // F2: transformed elements incl. the expansion delta (mergeElements dedupes by
  // id, drops dangling edges and tags new nodes `expanded`). Returns the base
  // reference untouched when there is nothing to add — no canvas churn.
  const expandedElements = useMemo<GraphElements>(() => {
    const base = graphElements ?? EMPTY_ELEMENTS;
    if (expansion.nodes.length === 0 && expansion.edges.length === 0) return base;
    return mergeElements(base, expansion);
  }, [graphElements, expansion]);

  const typeCounts = useMemo(() => computeTypeCounts(expandedElements), [expandedElements]);

  // Merge the jurisprudence toggle into the per-type visibility set the canvas
  // consumes — a superset of the filter panel's manual hides.
  const effectiveHiddenNodeTypes = useMemo<ReadonlySet<string>>(() => {
    if (!hideJurisprudence) return hiddenNodeTypes;
    const next = new Set(hiddenNodeTypes);
    for (const t of JURISPRUDENCE_TYPES) next.add(t);
    return next;
  }, [hiddenNodeTypes, hideJurisprudence]);

  // Center node the canons attach to: the rendered node whose urn matches the
  // page urn (exact, else version-marker-stripped per gotcha #6). Audit item 3:
  // when the urn matches NO node, resolveCenterNodeId returns null (a floating
  // corona) instead of an arbitrary nodes[0] fallback.
  const centerNodeId = useMemo<string | null>(
    () => resolveCenterNodeId(nodes, urn, stripVersionMarker),
    [nodes, urn]
  );
  // Audit item 3 (optional note): the urn WAS resolvable to a subgraph (nodes
  // present) and IS an explicit center, but matched no node — the corona is
  // floating rather than silently anchored on the wrong article.
  const centerUnresolved = Boolean(urn) && nodes.length > 0 && centerNodeId === null;

  // The debate overlay (canon nodes + contrast arcs), derived from the latest
  // answer. Empty when there is no settled deliberation → withDeliberationOverlay
  // returns the real elements unchanged (no synthetic churn on exploration).
  const deliberationOverlay = useMemo(() => {
    // Defect #10: the debate overlay belongs to the center it was asked on —
    // never painted over a DIFFERENT center's subgraph.
    if (!scopeMatches || expertContributions.length === 0) return null;
    return buildDeliberationOverlay({
      contributions: expertContributions,
      conflicts,
      devilsAdvocateActive,
      devilsAdvocateExpert,
      centerNodeId,
    });
  }, [expertContributions, conflicts, devilsAdvocateActive, devilsAdvocateExpert, centerNodeId, scopeMatches]);

  // Canvas elements = real subgraph + expansion delta + overlay. The export
  // slice reads the RAW graph.data, so synthetic overlay elements never pollute
  // an export; the drawer reads the MERGED nodes/edges (expanded nodes are real
  // graph nodes and must be inspectable).
  const canvasElements = useMemo<GraphElements>(
    () => withDeliberationOverlay(expandedElements, deliberationOverlay),
    [expandedElements, deliberationOverlay],
  );

  const importedElements = useMemo(
    () => (importedSlice ? sliceToElements(importedSlice) : null),
    [importedSlice]
  );

  const toggleHidden = (set: ReadonlySet<string>, type: string): Set<string> => {
    const next = new Set(set);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    return next;
  };

  // Single navigation entry point: records the breadcrumb, resets selection,
  // and drives the fetch via the URL (so refresh/deeplink reproduce the state).
  // `type` (C1) is threaded into the URL so the article-vs-concept decision
  // survives a refresh / shared deeplink instead of only living in click state.
  const goToCenter = (target: string, label: string, type?: string | null): void => {
    push({ urn: target, label });
    clearGraphSelection();
    // Defect #4: a recenter is a fresh context — land on the debate, not on a
    // stale Nodo drawer of the previous center.
    switchTab('dibattito');
    const next: Record<string, string> = { urn: target, depth: String(depth), layout };
    if (type) next.type = type;
    setSearchParams(next);
  };

  // Depth changes refetch (depth is a useArticleGraph dep); layout changes only
  // re-run the client-side layout. Both round-trip the URL for shareable deeplinks.
  const setDepth = (d: number): void => {
    if (urn) setSearchParams(withCenterType({ urn, depth: String(d), layout }, centerType));
  };
  const setLayout = (l: GraphLayoutName): void => {
    if (urn) setSearchParams(withCenterType({ urn, depth: String(depth), layout: l }, centerType));
  };

  const handleSelect = (item: GraphSearchItem): void => {
    // C1: pass the search-result node type through so the center is classified
    // as article vs concept downstream (drives the C2 ingestion gate).
    goToCenter(item.urn ?? item.id, item.nome ?? item.id, item.tipo);
  };

  const handleRecenter = (node: GraphNode): void => {
    goToCenter(node.urn ?? node.id, node.label, node.type);
  };

  // A node click on the canvas selects it AND flips the column to the Nodo tab
  // so its details are visible (design §4 — click a node → inspect it). Clears
  // any edge selection so the Nodo tab shows exactly one target.
  // Defect #5: a CANON star is not a graph node to inspect — it routes to the
  // Dibattito tab and expands that canon's thesis instead of an empty drawer.
  const handleNodeClick = (id: string): void => {
    revealColumn(); // a node click routes to the column — reveal it if collapsed
    const canonKey = canonKeyFromNodeId(id);
    if (canonKey) {
      switchTab('dibattito');
      setCanonFocus((prev) => ({ key: canonKey, nonce: (prev?.nonce ?? 0) + 1 }));
      return;
    }
    setSelectedNodeId(id);
    setSelectedEdge(null);
    setSelectedEdgeId(null);
    switchTab('nodo');
  };

  // F3: click on the empty canvas background — clear the selection AND the
  // inspection drawer with one gesture (mirror of Esc).
  const handleCanvasClick = useCallback((): void => {
    clearGraphSelection();
    switchTab('dibattito');
  }, [clearGraphSelection, switchTab]);

  // F2: double-click = EXPAND IN PLACE (the graph-explorer gesture; recentering
  // remains the drawer's explicit "Centra qui"). Fetches the node's depth-1
  // neighborhood and merges it into the view — the camera never moves (the
  // canvas applies pure additions via incremental addData, gotcha-free).
  const handleNodeExpand = (id: string): void => {
    if (isDeliberationElementId(id)) return; // synthetic canon/contrast elements
    if (pendingExpandId) return; // one expansion at a time
    const node = nodesById.get(id);
    if (!node) return;
    if (expandedNodeIds.has(id)) {
      setToast({ message: 'Nodo già espanso.', type: 'info' });
      return;
    }
    if (nodes.length >= MAX_GRAPH_NODES) {
      setToast({ message: 'Grafo pieno — nascondi qualcosa o ricentra.', type: 'info' });
      return;
    }
    const epoch = expandEpochRef.current;
    setPendingExpandId(id);
    fetchNodeNeighborhood(node.urn ?? node.id, EXPAND_FETCH_LIMIT)
      .then((delta) => {
        if (expandEpochRef.current !== epoch) return; // center changed mid-flight
        setPendingExpandId(null);
        const known = mergedIdsRef.current;
        const freshNodes = delta.nodes.filter((n) => !known.nodes.has(n.id));
        const freshEdges = delta.edges.filter((e) => !known.edges.has(rawEdgeKey(e)));
        if (known.nodes.size + freshNodes.length > MAX_GRAPH_NODES) {
          setToast({ message: 'Grafo pieno — nascondi qualcosa o ricentra.', type: 'info' });
          return;
        }
        setExpandedNodeIds((prev) => new Set(prev).add(id));
        if (freshNodes.length === 0 && freshEdges.length === 0) {
          setToast({ message: 'Nessun nuovo collegamento da aggiungere.', type: 'info' });
          return;
        }
        setExpansion((prev) => appendExpansion(prev, delta));
      })
      .catch((err: unknown) => {
        console.error('GraphExplorerPage: node expansion failed:', err);
        if (expandEpochRef.current !== epoch) return;
        setPendingExpandId(null);
        setToast({ message: 'Espansione non riuscita — riprova.', type: 'info' });
      });
  };

  // Real relation edges keyed by id (raw subgraph, NOT the overlaid set) so a
  // relation click resolves to a GraphEdge; contrast arcs resolve via conflicts.
  const edgesById = useMemo<Map<string, GraphEdge>>(
    () => new Map(edges.map((e) => [e.id ?? `${e.source}-${e.type}-${e.target}`, e])),
    [edges],
  );

  // An edge click (real relation OR synthetic contrast arc) → resolve to a
  // GraphEdgeSelection and open the Nodo tab (design §4/P2a "edge:click →
  // EdgeDetailsDrawer" + the contrast-arc detail). Canon-anchor tethers resolve
  // to null and are ignored (structural, not inspectable).
  const handleEdgeClick = (edgeId: string): void => {
    const selection = resolveEdgeSelection(edgeId, {
      edgesById,
      conflicts,
      devilsAdvocateActive,
      devilsAdvocateExpert,
      canonLabel: (key) => CANON_LABEL[key] ?? key,
    });
    if (!selection) return;
    revealColumn(); // an edge click opens the Nodo tab — reveal the column if collapsed
    setSelectedEdge(selection);
    setSelectedEdgeId(edgeId); // F3: the canvas paints 'selected' on this id
    setSelectedNodeId(null);
    setActiveTab('nodo');
  };

  // Slice 4 L3 — "privilegia questa relazione": mirror of onPreferCanon (P2b),
  // but for the traversal head. Binds the LATEST trace_id to the NEW relation
  // feedback channel; fire-and-forget like useQaThread.prefer (a failed teach is
  // never surfaced — the column already flipped to its optimistic confirmation).
  const handlePreferRelation = useCallback(
    (relationType: string): void => {
      if (!latestTraceId) return;
      void sendRelationFeedback(latestTraceId, relationType).catch((e) =>
        console.error('sendRelationFeedback failed:', e),
      );
    },
    [latestTraceId],
  );

  // Nodes-as-context: add the inspected node to the basket (drawer button), and
  // remove one (chip ×). Add is deduped and capped; the toast only fires when the
  // cap blocks a genuinely new node (read basket in render scope, not in the
  // updater, so a StrictMode double-invoke can't double-toast).
  const handleAddToContext = useCallback(
    (node: GraphNode): void => {
      if (contextBasket.length >= MAX_CONTEXT_ITEMS && !contextBasket.some((it) => it.id === node.id)) {
        setToast({ message: `Contesto pieno (max ${MAX_CONTEXT_ITEMS}) — rimuovi qualcosa.`, type: 'info' });
        return;
      }
      setContextBasket((prev) =>
        prev.some((it) => it.id === node.id) ? prev : [...prev, toContextItem(node)],
      );
    },
    [contextBasket],
  );
  const handleRemoveContext = useCallback((id: string): void => {
    setContextBasket((prev) => prev.filter((it) => it.id !== id));
  }, []);

  // The basket, projected for the two consumers: chips for the AskGraphField, an
  // id set for the drawer's "Nel contesto" state.
  const contextChips = useMemo<ContextChip[]>(
    () => contextBasket.map((i) => ({ id: i.id, label: i.label })),
    [contextBasket],
  );
  const contextIds = useMemo<ReadonlySet<string>>(
    () => new Set(contextBasket.map((i) => i.id)),
    [contextBasket],
  );

  // Header/column "Chiedi al grafo": fire the ask and surface the Dibattito tab.
  // Records the ask-time center (defect #10) so the deliberation stays scoped to
  // it when the user recenters elsewhere mid-flight. The context basket (the
  // selected nodes) travels to MERL-T as `context.entities`; an empty basket is
  // an unanchored ask.
  const handleAsk = useCallback(
    (question: string, mode: QaMode): void => {
      setAskScope(urn ? { urn, label: centerLabel ?? urn, type: centerType } : null);
      switchTab('dibattito');
      revealColumn(); // an ask from the collapsed header must reveal its answer
      void qa.ask(question, mode, { context: basketToContext(contextBasket) });
    },
    [qa, urn, centerLabel, centerType, switchTab, revealColumn, contextBasket],
  );

  // P1.10: one collegial run at a time — both AskGraphField instances share this.
  // 'partial' (async progressive Q&A) is still an in-flight deliberation.
  const qaBusy = qa.turns.some((t) => t.state.status === 'loading' || t.state.status === 'partial');

  // Defect #10: the deliberation lives on ANOTHER center — the Dibattito tab
  // shows a compact chip whose "Torna" recenters on the ask-time urn.
  const scopeChip =
    !scopeMatches && askScope && qa.turns.length > 0
      ? {
          label: askScope.label,
          onReturn: () => goToCenter(askScope.urn, askScope.label, askScope.type),
        }
      : null;

  // A deliberation source chip re-centers the CANVAS (design §3.2). node_id is a
  // real graph node id → if it's in the current subgraph, animate the camera to
  // it and select it (F3 focusNode — NO navigation: center, subgraph and debate
  // stay put); otherwise navigate by urn.
  const handleSourceCenter = (nodeIdOrUrn: string): void => {
    const local = resolveLocalSourceNode(nodeIdOrUrn, nodesById, nodes);
    if (local) {
      setSelectedNodeId(local.id);
      setSelectedEdge(null);
      setSelectedEdgeId(null);
      setActiveTab('nodo');
      canvasRef.current?.focusNode(local.id, { select: true });
      return;
    }
    // Not in the current subgraph → treat as a urn and re-center the graph.
    goToCenter(nodeIdOrUrn, labelFor(nodeIdOrUrn, entries));
  };

  // Audit item 3a: hovering a source chip pulses the matching canvas node
  // WITHOUT navigating, selecting, or switching tabs — the explicit re-center
  // click (handleSourceCenter above) stays the only destructive action. A
  // source not currently on canvas is a no-op (resolveLocalSourceNode → null).
  const [hoveredSourceId, setHoveredSourceId] = useState<string | null>(null);
  const handleSourceHover = useCallback(
    (nodeIdOrUrn: string | null): void => {
      if (!nodeIdOrUrn) {
        setHoveredSourceId(null);
        return;
      }
      const local = resolveLocalSourceNode(nodeIdOrUrn, nodesById, nodes);
      setHoveredSourceId(local?.id ?? null);
    },
    [nodesById, nodes],
  );

  // "Apri" (feature 3, quick-open): open a cited/consulted norma in the
  // VisuaLex reader — the vanilla navigate('/') + triggerSearch mechanism
  // (same as ValidationPage/ValidationCard), distinct from handleSourceCenter's
  // canvas re-center.
  const handleOpenNorm = useCallback(
    (params: SearchParams): void => {
      navigate('/');
      triggerSearch(params);
    },
    [navigate, triggerSearch],
  );

  // MARQUEE feature: "Segui il ragionamento sul grafo" — the column's per-turn
  // button hands the walk UP here; the main canvas takes it over (replacing
  // the article subgraph / empty state) until "Chiudi il replay" clears it.
  const handleFollowReasoning = useCallback((edges: GraphTraversalEdge[]): void => {
    setActiveWalk(edges);
  }, []);

  // #7: export the current subgraph to a local JSON the user keeps off-server.
  const handleExportSlice = (): void => {
    if (graph.status !== 'success') return;
    const snap = buildSnapshot(
      graph.data.nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, urn: n.urn })),
      graph.data.edges.map((e) => ({
        id: e.id ?? `${e.source}-${e.type}-${e.target}`,
        source: e.source,
        target: e.target,
        type: e.type,
      })),
      urn ?? undefined,
    );
    downloadSnapshot(snap, `merlt-slice-${Date.now()}.json`);
  };

  const handleImportFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const snap = parseSnapshot(await file.text());
      setImportedSlice(snap);
      clearGraphSelection();
    } catch (err) {
      setToast({
        message: err instanceof SnapshotParseError ? err.message : 'Slice non valido.',
        type: 'info',
      });
    }
  };

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="h-8 w-8 text-slate-400" />
        <p className="text-slate-600 dark:text-slate-300">Grafo non disponibile.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex flex-col flex-wrap gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary-600" />
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Grafo giuridico</h1>
        </div>
        <div className="sm:max-w-xs sm:flex-1">
          <GraphSearchBox onSelect={handleSelect} />
        </div>
        {/* Distinct "Chiedi al grafo" ask affordance (design §3): message icon,
            prefilled with the current center. Single-composer rule: on desktop it
            shows ONLY when the column is collapsed (otherwise the column's own
            bottom composer is the ask surface — no duplication). Below md it always
            shows: the docked column is replaced by the mobile bottom-sheet. */}
        <div className={cn('sm:max-w-sm sm:flex-1', !columnCollapsed && 'md:hidden')}>
          <AskGraphField
            contextItems={contextChips}
            onRemoveContext={handleRemoveContext}
            disabled={!qaAskable}
            busy={qaBusy}
            onAsk={handleAsk}
          />
        </div>
        {urn && (
          <DepthSelector depth={depth} layout={layout} onDepthChange={setDepth} onLayoutChange={setLayout} />
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleExportSlice}
            disabled={graph.status !== 'success' || nodes.length === 0}
            title="Esporta lo slice corrente come file locale"
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Download size={14} /> Esporta slice
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Carica e visualizza uno slice salvato localmente"
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Upload size={14} /> Carica slice
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Carica slice"
            onChange={(e) => {
              void handleImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <BreadcrumbHistory entries={entries} onNavigate={(u) => goToCenter(u, labelFor(u, entries))} />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-h-0 flex-1">
          {activeWalk ? (
            // MARQUEE feature (moved to the main canvas per user feedback: the
            // docked column's ~170px slot was too cramped for a 60+ edge walk).
            // Takes over the WHOLE main region — same precedence as the
            // imported-slice view below — restoring the article subgraph /
            // empty state on close.
            <Suspense fallback={<CanvasSkeleton />}>
              <GraphTraversalPlayer walk={activeWalk} onClose={() => setActiveWalk(null)} />
            </Suspense>
          ) : importedElements ? (
            <div className="relative h-full">
              <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 shadow dark:bg-amber-950/40 dark:text-amber-300">
                Slice locale (sola lettura)
                <button
                  type="button"
                  onClick={() => setImportedSlice(null)}
                  className="flex items-center gap-0.5 rounded px-1 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  aria-label="Chiudi slice locale"
                >
                  <X size={12} /> Chiudi
                </button>
              </div>
              <Suspense fallback={<CanvasSkeleton />}>
                <GraphCanvas
                  nodes={importedElements.nodes}
                  edges={importedElements.edges}
                  layout={layout}
                  height="100%"
                  hiddenNodeTypes={new Set()}
                  hiddenEdgeTypes={new Set()}
                  highlightNodeType={null}
                  onNodeClick={() => {}}
                  onNodeDblClick={() => {}}
                />
              </Suspense>
            </div>
          ) : !urn ? (
            <EmptyState sources={latestSources} onSelectSource={handleSourceCenter} />
          ) : graph.status === 'loading' || graph.status === 'idle' ? (
            // F1: 'loading' only happens when NOTHING was ever rendered (the
            // hook hands back 'revalidating' + previous elements otherwise), so
            // the full skeleton is strictly a first-load affair.
            <CanvasSkeleton />
          ) : graph.status === 'error' ? (
            <ErrorState onRetry={graph.refetch} />
          ) : graph.data.nodes.length === 0 ? (
            // C3: a concept center with an empty subgraph means "no neighbours /
            // not found" — NOT an article to (re-)ingest. No spinner, no
            // "Articolo non indicizzabile", no retry.
            !centerIsArticle ? (
              <ConceptEmptyState />
            ) : // The ingestion trigger failed: distinct copy per cause (design §3.4).
            triggerError === 'consent' ? (
              <IngestionErrorState
                tone="amber"
                message="Per costruire il grafo serve il consenso."
                onRetry={retryIngestion}
              />
            ) : triggerError === 'unavailable' || job.status === 'timeout' ? (
              // 5xx/network trigger failure OR polling budget/job timeout:
              // MERL-T is unreachable or too slow — never an unbounded spinner.
              <IngestionErrorState
                tone="red"
                message="Grafo non raggiungibile — riprova più tardi."
                onRetry={retryIngestion}
              />
            ) : job.status === 'failed' || job.status === 'completed' ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <AlertCircle className="h-8 w-8 text-amber-500" />
                <p className="text-slate-500 dark:text-slate-400">Articolo non indicizzabile nel grafo.</p>
                <button
                  type="button"
                  onClick={graph.refetch}
                  className="rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  Riprova
                </button>
              </div>
            ) : (
              <div role="status" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
                <p className="text-slate-500 dark:text-slate-400">Indicizzazione in corso…</p>
              </div>
            )
          ) : (
            <Suspense fallback={<CanvasSkeleton />}>
              {/* Top-left overlay stack: the "nascondi giurisprudenza" pill and
                  the filter panel share ONE flex column — both used to sit at
                  the same absolute left-3/top-3 slot and collided. */}
              <div className="absolute left-3 top-3 z-20 flex w-60 max-w-[80%] flex-col items-start gap-2">
                {/* Primary "nascondi giurisprudenza" control (design §4/§8): the
                    one real legibility lever, promoted out of the filter panel.
                    Default-on while a deliberation is active. */}
                <button
                  type="button"
                  onClick={() => setHideJurisManual(!hideJurisprudence)}
                  aria-pressed={hideJurisprudence}
                  title="Nascondi le sentenze per alleggerire il grafo"
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    hideJurisprudence
                      ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-300'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  <EyeOff size={14} /> Nascondi giurisprudenza
                </button>
                <GraphFilterPanel
                  nodeTypes={typeCounts.nodes}
                  edgeTypes={typeCounts.edges}
                  hiddenNodeTypes={hiddenNodeTypes}
                  hiddenEdgeTypes={hiddenEdgeTypes}
                  onToggleNodeType={(t) => setHiddenNodeTypes((s) => toggleHidden(s, t))}
                  onToggleEdgeType={(t) => setHiddenEdgeTypes((s) => toggleHidden(s, t))}
                  onSetAllNodes={(hidden) =>
                    setHiddenNodeTypes(hidden ? new Set(typeCounts.nodes.map((n) => n.type)) : new Set())
                  }
                  onSetAllEdges={(hidden) =>
                    setHiddenEdgeTypes(hidden ? new Set(typeCounts.edges.map((e) => e.type)) : new Set())
                  }
                  onHoverType={setHighlightType}
                />
                {/* Audit item 2: on-canvas caption for the deliberation overlay —
                    the canon corona's colours otherwise have no legend anywhere
                    on the page. Hidden when there is no active deliberation. */}
                {deliberationOverlay && <CanonLegend unresolvedCenter={centerUnresolved} />}
              </div>
              <GraphCanvas
                ref={canvasRef}
                nodes={canvasElements.nodes}
                edges={canvasElements.edges}
                layout={layout}
                height="100%"
                centerNodeId={centerNodeId}
                hiddenNodeTypes={effectiveHiddenNodeTypes}
                hiddenEdgeTypes={hiddenEdgeTypes}
                highlightNodeType={highlightType}
                highlightNodeIds={effectiveSourceHighlightIds}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                pulseNodeId={pendingExpandId ?? hoveredSourceId}
                onCanvasClick={handleCanvasClick}
                onNodeClick={handleNodeClick}
                onNodeDblClick={handleNodeExpand}
                onEdgeClick={handleEdgeClick}
              />
              {/* F1: revalidation veil — the previous graph stays live under a
                  thin progress bar + corner chip while the new data loads. */}
              {graph.status === 'revalidating' && (
                <>
                  <div className="absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-primary-500/80" />
                  <div
                    role="status"
                    className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur dark:bg-slate-900/85 dark:text-slate-300"
                  >
                    <Loader2 size={12} className="animate-spin text-primary-500" />
                    Aggiornamento del grafo…
                  </div>
                </>
              )}
              {/* P1.9: dismissable "evidenza fonti" chip — the sources emphasis
                  fades the rest of the graph, so it must be one click to clear. */}
              {sourceHighlightIds && !sourceFadeDismissed && (
                <button
                  type="button"
                  onClick={() => setSourceFadeDismissed(true)}
                  aria-label="Rimuovi evidenza fonti"
                  title="Rimuovi l'evidenza delle fonti consultate"
                  className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 shadow-sm transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-300 dark:hover:bg-primary-950/60"
                >
                  <X size={12} /> Evidenza fonti
                </button>
              )}
              {/* F4 honest truncation: "Mostro N di M relazioni" + Carica di più. */}
              <GraphTruncationChip data={graphData} centerNodeId={centerNodeId} limit={limit} loading={graph.status === 'revalidating'} onLoadMore={setLimit} />
              {/* P1.7: one-click re-fit after zoom/pan wanderings. */}
              <button
                type="button"
                onClick={() => canvasRef.current?.fit()}
                title="Adatta il grafo alla vista"
                className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Maximize2 size={14} /> Adatta alla vista
              </button>
            </Suspense>
          )}
        </main>

        {/* Audit item 4: draggable splitter between the canvas and the docked
            column. Hidden on mobile (bottom-sheet instead) and while collapsed
            (the thin rail is the extreme of the resize range). */}
        {!columnCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ridimensiona il pannello del dibattito"
            aria-valuenow={columnWidth}
            aria-valuemin={COLUMN_WIDTH_MIN}
            aria-valuemax={COLUMN_WIDTH_MAX}
            tabIndex={0}
            onMouseDown={handleSplitterMouseDown}
            onKeyDown={handleSplitterKeyDown}
            className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 md:block"
          />
        )}

        {/* Docked deliberation column (design §4): the canvas is `flex-1`, so a
            fixed-width sibling reflows it to `calc(100% − columnWidth)` — no
            imperative padding. Dual-tab: Dibattito (the absorbed Q&A) / Nodo
            (details). Width is draggable (audit item 4), clamped + persisted. */}
        <div
          className={cn(
            'hidden shrink-0 overflow-hidden md:block',
            !isResizingColumn && 'transition-[width] duration-200',
            columnCollapsed && 'w-11',
          )}
          style={columnCollapsed ? undefined : { width: columnWidth }}
        >
          <DeliberationColumn
            activeTab={activeTab}
            onTabChange={switchTab}
            collapsed={columnCollapsed}
            onToggleCollapse={toggleColumnCollapsed}
            turns={qa.turns}
            onAsk={handleAsk}
            contextItems={contextChips}
            onRemoveContext={handleRemoveContext}
            onAddToContext={handleAddToContext}
            contextIds={contextIds}
            onRetry={qa.retry}
            onCancel={qa.cancel}
            onSourceCenter={handleSourceCenter}
            onSourceHover={handleSourceHover}
            onOpenNorm={handleOpenNorm}
            onFollowReasoning={handleFollowReasoning}
            onLoadHistoryTurn={qa.loadHistoryTurn}
            onRate={qa.rate}
            onRateSource={qa.rateSrc}
            onDetailed={qa.detailed}
            onConfirmSource={qa.confirm}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            expertContributions={expertContributions}
            canContribute={canContribute}
            // Steering is scoped to the deliberation's own center (defect #10):
            // off-scope the canon steer hides with the rest of the overlay.
            onPreferCanon={scopeMatches ? qa.prefer : undefined}
            // No settled trace → undefined → the column hides the edge steer
            // entirely (steering needs a deliberation to attach to).
            onPreferRelation={latestTraceId ? handlePreferRelation : undefined}
            onOpenConsent={() => setConsentDialogOpen(true)}
            qaAskable={qaAskable}
            askBusy={qaBusy}
            dibattitoBadge={dibattitoBadge}
            scopeChip={scopeChip}
            canonFocus={canonFocus}
            nodesById={nodesById}
            edges={edges}
            onRecenter={handleRecenter}
            onCloseNode={() => {
              clearGraphSelection();
              switchTab('dibattito');
            }}
          />
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible
          onClose={() => setToast(null)}
        />
      )}

      {/* Consent dialog opened from the "pesa di più questo canone" upsell (§5 L2):
          lets the jurist grant `full` consent so the steer control unlocks. Mounted
          only while open — the dialog consumes `useConsent()` unconditionally, so
          gating the mount keeps it inert (and provider-free) until actually needed. */}
      {consentDialogOpen && (
        <ConsentDialog open onClose={() => setConsentDialogOpen(false)} />
      )}
    </div>
  );
}

/** Best-known label for a breadcrumb urn (falls back to the urn itself). */
function labelFor(urn: string, entries: ReturnType<typeof useBreadcrumbHistory>['entries']): string {
  return entries.find((e) => e.urn === urn)?.label ?? urn;
}

/** Stable key of a RAW BFF edge (same synthesis rule as graphTransform). */
function rawEdgeKey(e: GraphEdge): string {
  return e.id ?? `${e.source}-${e.type}-${e.target}`;
}

/** F2: append a fetched delta to the accumulated expansion, deduped by id. */
function appendExpansion(
  prev: ExpansionDelta,
  delta: Pick<ExpansionDelta, 'nodes' | 'edges'>
): ExpansionDelta {
  const nodeIds = new Set(prev.nodes.map((n) => n.id));
  const edgeIds = new Set(prev.edges.map(rawEdgeKey));
  return {
    nodes: [...prev.nodes, ...delta.nodes.filter((n) => !nodeIds.has(n.id))],
    edges: [...prev.edges, ...delta.edges.filter((e) => !edgeIds.has(rawEdgeKey(e)))],
  };
}

/**
 * Strip the NIR version/annex marker (`!vig=`, `!multivigente`, …) from a urn so
 * the graph's marker-less seed urns match VisuaLex's marker-carrying urns
 * (gotcha #6). Best-effort center matching only — the canvas keeps the raw urn.
 */
function stripVersionMarker(urn: string): string {
  const i = urn.indexOf('!');
  return i === -1 ? urn : urn.slice(0, i);
}

/** Preserve the current center `type` param across depth/layout URL updates. */
function withCenterType(
  params: Record<string, string>,
  centerType: string | null
): Record<string, string> {
  return centerType ? { ...params, type: centerType } : params;
}

/** Map a local snapshot to the cytoscape-ready element shape (#7 read-only view). */
function sliceToElements(snap: GraphSliceSnapshot): GraphElements {
  return {
    nodes: snap.nodes.map((n) => ({
      id: n.id,
      data: { label: n.label ?? n.id, type: n.type ?? 'Nodo', urn: n.urn ?? undefined },
    })),
    edges: snap.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: { label: e.type ?? '', type: e.type ?? '' },
    })),
  };
}

/**
 * Audit item 2: when the last Q&A answer consulted sources, surface them as
 * clickable chips so the jurist can jump straight into the graph from the
 * conversation instead of re-searching. Falls back to the plain copy when
 * there is no recent answer (or it carried no sources).
 */
function EmptyState({
  sources,
  onSelectSource,
}: {
  sources: QaRetrievedSource[];
  onSelectSource: (nodeIdOrUrn: string) => void;
}): React.ReactElement {
  const chips = pickEmptyStateSources(sources, MAX_EMPTY_STATE_SOURCES);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Network className="h-10 w-10 text-slate-300 dark:text-slate-600" />
      <p className="max-w-sm text-slate-500 dark:text-slate-400">
        Cerca un articolo o un concetto per iniziare a esplorare il grafo.
      </p>
      {chips.length > 0 && (
        <div className="flex max-w-md flex-col items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Fonti dell&apos;ultima domanda
          </span>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {chips.map((s) => (
              <button
                key={s.node_id ?? s.urn}
                type="button"
                onClick={() => onSelectSource(s.node_id ?? s.urn)}
                title={`Apri ${sourceLabel(s)} nel grafo`}
                className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-700 dark:hover:bg-primary-950/40 dark:hover:text-primary-300"
              >
                {sourceLabel(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Audit item 2 — "il collegio dei canoni" caption pinned in the canvas's
 * top-left overlay stack, mounted only while a deliberation overlay is on
 * canvas. Reuses {@link CANON_STYLE} so the swatches never drift from the
 * actual canon-node colours, plus one dashed sample for the contrast arc.
 */
function CanonLegend({ unresolvedCenter }: { unresolvedCenter: boolean }): React.ReactElement {
  return (
    <div className="w-full rounded-md border border-slate-200 bg-white/90 px-2.5 py-2 text-xs text-slate-600 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300">
      <p className="mb-1 font-semibold text-slate-500 dark:text-slate-400">Il collegio dei canoni</p>
      <ul className="space-y-0.5">
        {CANON_KEYS.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CANON_STYLE[key].color }}
              aria-hidden="true"
            />
            {CANON_STYLE[key].label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            className="h-0 w-3 shrink-0 border-t-2 border-dashed"
            style={{ borderColor: CONTRAST_ARC_COLOR }}
            aria-hidden="true"
          />
          contrasto
        </li>
      </ul>
      {/* Audit item 3 (optional note): the corona is floating — say so instead
          of leaving the jurist to wonder why nothing seems anchored. */}
      {unresolvedCenter && (
        <p className="mt-1.5 border-t border-slate-100 pt-1.5 italic text-slate-400 dark:border-slate-800 dark:text-slate-500">
          centro non individuato
        </p>
      )}
    </div>
  );
}

/**
 * C3: empty-subgraph state for a concept center. Unlike an article, a concept
 * is never lazy-ingested, so this is a terminal, no-retry message — not an
 * "indicizzazione in corso" spinner nor "Articolo non indicizzabile".
 */
function ConceptEmptyState(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Network className="h-8 w-8 text-slate-300 dark:text-slate-600" />
      <p className="max-w-sm text-slate-500 dark:text-slate-400">
        Concetto non collegato nel grafo.
      </p>
    </div>
  );
}

/** Ingestion-failure fallback: cause-specific copy + a retry that resets the
 *  trigger machine (design §3.4 — no infinite "sto indicizzando" spinner). */
function IngestionErrorState({
  tone,
  message,
  onRetry,
}: {
  tone: 'amber' | 'red';
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertCircle className={tone === 'amber' ? 'h-8 w-8 text-amber-500' : 'h-8 w-8 text-red-500'} />
      <p className="text-slate-500 dark:text-slate-400">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        Riprova
      </button>
    </div>
  );
}

function CanvasSkeleton(): React.ReactElement {
  return (
    <div role="status" className="flex h-full items-center justify-center p-8">
      <div className="h-full w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
    </div>
  );
}

/** P1.11: load failures offer an in-place "Riprova" wired to the graph refetch. */
function ErrorState({ onRetry }: { onRetry: () => void }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertCircle className="h-8 w-8 text-red-500" />
      <p className="text-slate-500 dark:text-slate-400">Errore nel caricamento del grafo.</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        Riprova
      </button>
    </div>
  );
}
