import { Suspense, lazy, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Network } from 'lucide-react';
import { isMerltGraphEnabled } from '../featureFlag';
import { useArticleGraph } from '../shared/useArticleGraph';
import type { GraphNode, GraphSearchItem } from '../shared/types';
import type { GraphLayoutName } from '../shared/CytoscapeView';
import { GraphSearchBox } from './GraphSearchBox';
import { BreadcrumbHistory } from './BreadcrumbHistory';
import { NodeDetailsDrawer } from './NodeDetailsDrawer';
import { DepthSelector } from './DepthSelector';
import { LAYOUT_OPTIONS } from './graphLayouts';
import { useBreadcrumbHistory } from './useBreadcrumbHistory';

const CytoscapeView = lazy(() => import('../shared/CytoscapeView'));

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

  const nodes = graph.status === 'success' ? graph.data.nodes : [];
  const edges = graph.status === 'success' ? graph.data.edges : [];
  const nodesById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

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
      </header>

      <BreadcrumbHistory entries={entries} onNavigate={(u) => goToCenter(u, labelFor(u, entries))} />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-h-0 flex-1">
          {!urn ? (
            <EmptyState />
          ) : graph.status === 'loading' || graph.status === 'idle' ? (
            <CanvasSkeleton />
          ) : graph.status === 'error' ? (
            <ErrorState />
          ) : graph.data.nodes.length === 0 ? (
            <CenteredText text="Nessun nodo per questo elemento." />
          ) : (
            <Suspense fallback={<CanvasSkeleton />}>
              <CytoscapeView
                nodes={graph.elements.nodes}
                edges={graph.elements.edges}
                layout={layout}
                height="100%"
                onNodeClick={setSelectedNodeId}
                onNodeDblClick={(id) => {
                  const n = nodesById.get(id);
                  if (n) handleRecenter(n);
                }}
              />
            </Suspense>
          )}
        </main>

        {selectedNode && (
          <aside className="hidden w-[300px] shrink-0 border-l border-slate-200 dark:border-slate-800 lg:block">
            <NodeDetailsDrawer
              node={selectedNode}
              edges={edges}
              nodesById={nodesById}
              onRecenter={handleRecenter}
              onClose={() => setSelectedNodeId(null)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Best-known label for a breadcrumb urn (falls back to the urn itself). */
function labelFor(urn: string, entries: ReturnType<typeof useBreadcrumbHistory>['entries']): string {
  return entries.find((e) => e.urn === urn)?.label ?? urn;
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
