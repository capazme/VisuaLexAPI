import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Download, EyeOff, Loader2, Network, Upload, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { isMerltGraphEnabled } from '../featureFlag';
import { useMerltFeatures } from '../../useMerltFeatures';
import { useQaThread } from '../../qa/useQaThread';
import { sendRelationFeedback } from '../../qa/qaApi';
import type { QaMode, QaPrefillState, QaRetrievedSource } from '../../qa/types';
import { useArticleGraph } from '../shared/useArticleGraph';
import type { GraphElements } from '../shared/graphTransform';
import {
  buildDeliberationOverlay,
  readDeliberation,
  resolveEdgeSelection,
  withDeliberationOverlay,
} from '../shared/graphDeliberation';
import type {
  DisagreementConflict,
  ExpertContribution,
  GraphEdge,
  GraphEdgeSelection,
} from '../shared/types';
import { CANON_LABEL } from '../../qa/format';
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
  triggerIngestion,
  type IngestionTriggerErrorKind,
} from '../shared/graphApi';
import type { GraphNode, GraphSearchItem } from '../shared/types';
import type { GraphLayoutName } from '../shared/GraphCanvas';
import { Toast } from '../../../../components/ui/Toast';
import { computeTypeCounts } from '../shared/graphFilters';
import { GraphSearchBox } from './GraphSearchBox';
import { AskGraphField } from './AskGraphField';
import { DeliberationColumn } from './DeliberationColumn';
import { ConsentDialog } from '../../consent/ConsentDialog';
import { BreadcrumbHistory } from './BreadcrumbHistory';
import { DepthSelector } from './DepthSelector';
import { GraphFilterPanel } from './GraphFilterPanel';
import { LAYOUT_OPTIONS } from './graphLayouts';
import { useBreadcrumbHistory } from './useBreadcrumbHistory';
import { isArticleCenter } from './graphCenter';

const GraphCanvas = lazy(() => import('../shared/GraphCanvas'));

/**
 * Node types that carry case-law density (the ~10k `AttoGiudiziario` sentenze +
 * `Caso`). "Nascondi giurisprudenza" toggles these (design §4/§8 — the one real
 * legibility lever), default-on while a deliberation is active.
 */
const JURISPRUDENCE_TYPES: readonly string[] = ['AttoGiudiziario', 'Caso'];

function clampDepth(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return 2;
  return Math.min(3, Math.max(1, n));
}

function parseLayout(raw: string | null): GraphLayoutName {
  const allowed = LAYOUT_OPTIONS.map((o) => o.value);
  return allowed.includes(raw as GraphLayoutName) ? (raw as GraphLayoutName) : 'cose-bilkent';
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
  const enabled = isMerltGraphEnabled();
  const { qaAskable, canContribute } = useMerltFeatures();
  const urn = searchParams.get('urn');
  const centerType = searchParams.get('type'); // C1: threaded so it survives refresh/deeplink
  const depth = clampDepth(searchParams.get('depth'));
  const layout = parseLayout(searchParams.get('layout'));
  // C2: only Norma/article centers are lazy-ingestable; concepts are not.
  const centerIsArticle = isArticleCenter(centerType, urn);
  // Hooks must run unconditionally; pass null urn when disabled so no fetch fires.
  const graph = useArticleGraph(enabled ? urn : null, depth);
  const { entries, push } = useBreadcrumbHistory();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Slice 4 P2a: a clicked edge (real relation or synthetic contrast arc). Lives
  // beside the node selection; a node click clears it and vice versa so the Nodo
  // tab shows exactly one inspection target.
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeSelection | null>(null);

  // Slice 4 P1: the page OWNS the Q&A thread (useQaThread lifted here); the
  // header field + deliberation column are presentational and receive turns +
  // handlers. `ask`/`retry`/`cancel` are stable callbacks (useCallback in the
  // hook), so passing them down does not thrash the column.
  const qa = useQaThread();
  // Deliberation column tab: 'dibattito' after an ask, 'nodo' after a node click.
  const [activeTab, setActiveTab] = useState<'dibattito' | 'nodo'>('dibattito');
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
    // Re-arm the derived default for "nascondi giurisprudenza" on the new center.
    setHideJurisManual(null);
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
      setActiveTab('dibattito');
      return;
    }
    prefillConsumedRef.current = true;
    setActiveTab('dibattito');
    void qa.ask(state.prefillQuery, 'convergent');
    // Strip the consumed prefill from history so reload / back does not re-fire it.
    navigate(location.pathname + location.search, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, qaAskable]);

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
  // outside the success branch — a stable sentinel the memos treat as "empty".)
  const graphData = graph.status === 'success' ? graph.data : undefined;
  const graphElements = graph.status === 'success' ? graph.elements : undefined;
  const nodes = useMemo(() => graphData?.nodes ?? [], [graphData]);
  const edges = useMemo(() => graphData?.edges ?? [], [graphData]);
  const nodesById = useMemo(() => new Map<string, GraphNode>(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

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

  // Is there an active/pending deliberation? Drives the "nascondi giurisprudenza"
  // default-on and the source highlight. True the moment the first turn appears.
  const hasDeliberation = qa.turns.length > 0;

  // Slice 4 P2a — the debate overlay reflects ONLY the LATEST turn's answer, and
  // only while it is settled successfully. A new ask (newest turn → loading) or a
  // failed turn clears the overlay, so synthetic canon/contrast elements never
  // linger over a stale or in-flight deliberation (lifecycle: §3).
  const latestAnswer = useMemo<unknown>(() => {
    const last = qa.turns[qa.turns.length - 1];
    return last?.state.status === 'success' ? last.state.answer : null;
  }, [qa.turns]);

  // Slice 4 L3 — the LATEST settled deliberation's trace_id: the handle every
  // relation steer attaches to. Same lifecycle as the overlay (an in-flight or
  // failed newest turn clears it), so the edge steer control hides exactly when
  // there is no current deliberation to teach against.
  const latestTraceId = useMemo<string | null>(() => {
    const last = qa.turns[qa.turns.length - 1];
    return last?.state.status === 'success' && last.state.answer.trace_id
      ? last.state.answer.trace_id
      : null;
  }, [qa.turns]);

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

  // Join retrieved_sources to canvas node ids: a source lands on the graph iff its
  // node_id (preferred) OR urn matches a node id/urn currently rendered. Uses the
  // TRANSFORMED elements' ids (same id space the canvas highlights on).
  const sourceHighlightIds = useMemo<ReadonlySet<string> | null>(() => {
    if (latestSources.length === 0) return null;
    const byUrn = new Map<string, string>();
    for (const n of nodes) if (n.urn) byUrn.set(n.urn, n.id);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const hit = new Set<string>();
    for (const s of latestSources) {
      if (s.node_id && nodeIds.has(s.node_id)) hit.add(s.node_id);
      else if (byUrn.has(s.urn)) hit.add(byUrn.get(s.urn)!);
    }
    return hit.size > 0 ? hit : null;
  }, [latestSources, nodes]);

  // "Nascondi giurisprudenza": manual override wins; otherwise default-on while a
  // deliberation is active (density mitigation), off in plain exploration.
  const hideJurisprudence = hideJurisManual ?? hasDeliberation;

  // Human label of the current center → prefills the AskGraphField placeholder.
  const centerLabel = urn ? labelFor(urn, entries) : undefined;

  const typeCounts = useMemo(
    () => (graphElements ? computeTypeCounts(graphElements) : { nodes: [], edges: [] }),
    [graphElements]
  );

  // Merge the jurisprudence toggle into the per-type visibility set the canvas
  // consumes — a superset of the filter panel's manual hides.
  const effectiveHiddenNodeTypes = useMemo<ReadonlySet<string>>(() => {
    if (!hideJurisprudence) return hiddenNodeTypes;
    const next = new Set(hiddenNodeTypes);
    for (const t of JURISPRUDENCE_TYPES) next.add(t);
    return next;
  }, [hiddenNodeTypes, hideJurisprudence]);

  // Center node the canons attach to: the rendered node whose urn matches the
  // page urn (exact, else version-marker-stripped per gotcha #6), else the first
  // node. Best-effort — canons float when there is no center (overlay handles it).
  const centerNodeId = useMemo<string | null>(() => {
    if (nodes.length === 0) return null;
    if (!urn) return nodes[0].id;
    const bare = stripVersionMarker(urn);
    const exact = nodes.find((n) => n.urn === urn);
    if (exact) return exact.id;
    const byBare = nodes.find((n) => n.urn && stripVersionMarker(n.urn) === bare);
    return (byBare ?? nodes[0]).id;
  }, [nodes, urn]);

  // The debate overlay (canon nodes + contrast arcs), derived from the latest
  // answer. Empty when there is no settled deliberation → withDeliberationOverlay
  // returns the real elements unchanged (no synthetic churn on exploration).
  const deliberationOverlay = useMemo(() => {
    if (expertContributions.length === 0) return null;
    return buildDeliberationOverlay({
      contributions: expertContributions,
      conflicts,
      devilsAdvocateActive,
      centerNodeId,
    });
  }, [expertContributions, conflicts, devilsAdvocateActive, centerNodeId]);

  // Canvas elements = real subgraph + overlay. The export-slice and the drawer
  // read the RAW graph.data/graph.elements, never this merged set, so synthetic
  // elements never pollute an export or a node/edge lookup.
  const canvasElements = useMemo<GraphElements>(
    () => withDeliberationOverlay(graphElements ?? { nodes: [], edges: [] }, deliberationOverlay),
    [graphElements, deliberationOverlay],
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
    setSelectedNodeId(null);
    setSelectedEdge(null);
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
  const handleNodeClick = (id: string): void => {
    setSelectedNodeId(id);
    setSelectedEdge(null);
    setActiveTab('nodo');
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
      canonLabel: (key) => CANON_LABEL[key] ?? key,
    });
    if (!selection) return;
    setSelectedEdge(selection);
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

  // Header/column "Chiedi al grafo": fire the ask and surface the Dibattito tab.
  const handleAsk = useCallback(
    (question: string, mode: QaMode): void => {
      setActiveTab('dibattito');
      void qa.ask(question, mode);
    },
    [qa],
  );

  // A deliberation source chip re-centers the CANVAS (design §3.2). node_id is a
  // real graph node id → if it's in the current subgraph, just select it (no
  // navigation); otherwise navigate by urn. Falls back to navigation for urns.
  const handleSourceCenter = (nodeIdOrUrn: string): void => {
    const local = nodesById.get(nodeIdOrUrn);
    if (local) {
      setSelectedNodeId(local.id);
      setSelectedEdge(null);
      setActiveTab('nodo');
      return;
    }
    const byUrn = nodes.find((n) => n.urn === nodeIdOrUrn);
    if (byUrn) {
      setSelectedNodeId(byUrn.id);
      setSelectedEdge(null);
      setActiveTab('nodo');
      return;
    }
    // Not in the current subgraph → treat as a urn and re-center the graph.
    goToCenter(nodeIdOrUrn, labelFor(nodeIdOrUrn, entries));
  };

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
      setSelectedNodeId(null);
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
      <header className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary-600" />
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Grafo giuridico</h1>
        </div>
        <div className="sm:max-w-xs sm:flex-1">
          <GraphSearchBox onSelect={handleSelect} />
        </div>
        {/* Distinct "Chiedi al grafo" ask affordance (design §3): message icon,
            prefilled with the current center. Presentational — page owns useQaThread. */}
        <div className="sm:max-w-sm sm:flex-1">
          <AskGraphField
            centerUrn={urn ?? undefined}
            centerLabel={centerLabel}
            disabled={!qaAskable}
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
          {importedElements ? (
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
            <EmptyState />
          ) : graph.status === 'loading' || graph.status === 'idle' ? (
            <CanvasSkeleton />
          ) : graph.status === 'error' ? (
            <ErrorState />
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
                  className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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
              {/* Primary "nascondi giurisprudenza" control (design §4/§8): the
                  one real legibility lever, promoted out of the filter panel.
                  Default-on while a deliberation is active. */}
              <button
                type="button"
                onClick={() => setHideJurisManual(!hideJurisprudence)}
                aria-pressed={hideJurisprudence}
                title="Nascondi le sentenze per alleggerire il grafo"
                className={cn(
                  'absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  hideJurisprudence
                    ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-300'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <EyeOff size={14} /> Nascondi giurisprudenza
              </button>
              <GraphCanvas
                nodes={canvasElements.nodes}
                edges={canvasElements.edges}
                layout={layout}
                height="100%"
                hiddenNodeTypes={effectiveHiddenNodeTypes}
                hiddenEdgeTypes={hiddenEdgeTypes}
                highlightNodeType={highlightType}
                highlightNodeIds={sourceHighlightIds}
                onNodeClick={handleNodeClick}
                onNodeDblClick={(id) => {
                  const n = nodesById.get(id);
                  if (n) handleRecenter(n);
                }}
                onEdgeClick={handleEdgeClick}
              />
            </Suspense>
          )}
        </main>

        {/* Docked deliberation column (design §4): the canvas is `flex-1`, so a
            fixed-width sibling reflows it to `calc(100% − 400px)` — no imperative
            padding. Dual-tab: Dibattito (the absorbed Q&A) / Nodo (details). */}
        <div className="hidden w-[400px] shrink-0 md:block">
          <DeliberationColumn
            activeTab={activeTab}
            onTabChange={setActiveTab}
            turns={qa.turns}
            onAsk={handleAsk}
            onRetry={qa.retry}
            onCancel={qa.cancel}
            onSourceCenter={handleSourceCenter}
            onLoadHistoryTurn={qa.loadHistoryTurn}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            expertContributions={expertContributions}
            canContribute={canContribute}
            onPreferCanon={qa.prefer}
            // No settled trace → undefined → the column hides the edge steer
            // entirely (steering needs a deliberation to attach to).
            onPreferRelation={latestTraceId ? handlePreferRelation : undefined}
            onOpenConsent={() => setConsentDialogOpen(true)}
            qaAskable={qaAskable}
            nodesById={nodesById}
            edges={edges}
            onRecenter={handleRecenter}
            onCloseNode={() => {
              setSelectedNodeId(null);
              setSelectedEdge(null);
              setActiveTab('dibattito');
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

function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Network className="h-10 w-10 text-slate-300 dark:text-slate-600" />
      <p className="max-w-sm text-slate-500 dark:text-slate-400">
        Cerca un articolo o un concetto per iniziare a esplorare il grafo.
      </p>
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
        className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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

function ErrorState(): React.ReactElement {
  return (
    <CenteredText text="Errore nel caricamento del grafo." icon />
  );
}

function CenteredText({ text, icon }: { text: string; icon?: boolean }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon && <AlertCircle className="h-8 w-8 text-red-500" />}
      <p className="text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );
}
