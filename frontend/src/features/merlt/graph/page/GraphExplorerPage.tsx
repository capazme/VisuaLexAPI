import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Download, Loader2, Network, Upload, X } from 'lucide-react';
import { isMerltGraphEnabled } from '../featureFlag';
import { useArticleGraph } from '../shared/useArticleGraph';
import type { GraphElements } from '../shared/graphTransform';
import {
  buildSnapshot,
  parseSnapshot,
  downloadSnapshot,
  SnapshotParseError,
  type GraphSliceSnapshot,
} from '../shared/snapshotIO';
import { useIngestionJob } from '../shared/useIngestionJob';
import { triggerIngestion } from '../shared/graphApi';
import type { GraphNode, GraphSearchItem } from '../shared/types';
import type { GraphLayoutName } from '../shared/GraphCanvas';
import { Toast } from '../../../../components/ui/Toast';
import { computeTypeCounts } from '../shared/graphFilters';
import { GraphSearchBox } from './GraphSearchBox';
import { BreadcrumbHistory } from './BreadcrumbHistory';
import { NodeDetailsDrawer } from './NodeDetailsDrawer';
import { DepthSelector } from './DepthSelector';
import { GraphFilterPanel } from './GraphFilterPanel';
import { LAYOUT_OPTIONS } from './graphLayouts';
import { useBreadcrumbHistory } from './useBreadcrumbHistory';

const GraphCanvas = lazy(() => import('../shared/GraphCanvas'));

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
  const enabled = isMerltGraphEnabled();
  const urn = searchParams.get('urn');
  const depth = clampDepth(searchParams.get('depth'));
  const layout = parseLayout(searchParams.get('layout'));
  // Hooks must run unconditionally; pass null urn when disabled so no fetch fires.
  const graph = useArticleGraph(enabled ? urn : null, depth);
  const { entries, push } = useBreadcrumbHistory();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Lazy ingestion: a urn that resolves to an empty subgraph isn't in the graph
  // yet — enqueue an ingestion job, poll it, then refetch when it completes.
  const [jobId, setJobId] = useState<string | null>(null);
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
    setHiddenNodeTypes(new Set());
    setHiddenEdgeTypes(new Set());
    setHighlightType(null);
  }, [urn]);

  useEffect(() => {
    if (graph.status !== 'success' || graph.data.nodes.length > 0) return;
    if (triggeredRef.current || !urn) return;
    triggeredRef.current = true;
    triggerIngestion(urn)
      .then((r) => setJobId(r.jobId))
      .catch(() => {
        /* opportunistic — empty state will show "non indicizzabile" */
      });
    // Keyed on status (data is undefined outside success; read at fire time;
    // triggeredRef guards re-entry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.status, urn]);

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

  const nodes = graph.status === 'success' ? graph.data.nodes : [];
  const edges = graph.status === 'success' ? graph.data.edges : [];
  const nodesById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  const typeCounts = useMemo(
    () => (graph.status === 'success' ? computeTypeCounts(graph.elements) : { nodes: [], edges: [] }),
    [graph]
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
  const goToCenter = (target: string, label: string): void => {
    push({ urn: target, label });
    setSelectedNodeId(null);
    setSearchParams({ urn: target, depth: String(depth), layout });
  };

  // Depth changes refetch (depth is a useArticleGraph dep); layout changes only
  // re-run the client-side layout. Both round-trip the URL for shareable deeplinks.
  const setDepth = (d: number): void => {
    if (urn) setSearchParams({ urn, depth: String(d), layout });
  };
  const setLayout = (l: GraphLayoutName): void => {
    if (urn) setSearchParams({ urn, depth: String(depth), layout: l });
  };

  const handleSelect = (item: GraphSearchItem): void => {
    goToCenter(item.urn ?? item.id, item.nome ?? item.id);
  };

  const handleRecenter = (node: GraphNode): void => {
    goToCenter(node.urn ?? node.id, node.label);
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
        <div className="flex-1 sm:max-w-md">
          <GraphSearchBox onSelect={handleSelect} />
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
            job.status === 'failed' || job.status === 'timeout' || job.status === 'completed' ? (
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
              <GraphCanvas
                nodes={graph.elements.nodes}
                edges={graph.elements.edges}
                layout={layout}
                height="100%"
                hiddenNodeTypes={hiddenNodeTypes}
                hiddenEdgeTypes={hiddenEdgeTypes}
                highlightNodeType={highlightType}
                onNodeClick={setSelectedNodeId}
                onNodeDblClick={(id) => {
                  const n = nodesById.get(id);
                  if (n) handleRecenter(n);
                }}
              />
            </Suspense>
          )}
          {selectedNode && (
            <div className="absolute bottom-3 right-3 top-3 z-20 flex w-[360px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <NodeDetailsDrawer
                node={selectedNode}
                edges={edges}
                nodesById={nodesById}
                onRecenter={handleRecenter}
                onClose={() => setSelectedNodeId(null)}
              />
            </div>
          )}
        </main>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

/** Best-known label for a breadcrumb urn (falls back to the urn itself). */
function labelFor(urn: string, entries: ReturnType<typeof useBreadcrumbHistory>['entries']): string {
  return entries.find((e) => e.urn === urn)?.label ?? urn;
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
