import { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Network } from 'lucide-react';
import { isMerltGraphEnabled } from '../featureFlag';
import { useArticleGraph } from '../shared/useArticleGraph';

const CytoscapeView = lazy(() => import('../shared/CytoscapeView'));

function clampDepth(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return 2;
  return Math.min(3, Math.max(1, n));
}

/**
 * Full-canvas knowledge-graph explorer at /grafo. Slice 2a-2 builds this up
 * story by story; 2a.8 ships the skeleton: query-param driven fetch, canvas,
 * empty/loading/error states, and a right column reserved for the node drawer
 * (2a.10). The search box (2a.9), depth/layout controls (2a.11) and breadcrumb
 * (2a.10) mount into the reserved regions later.
 */
export function GraphExplorerPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const enabled = isMerltGraphEnabled();
  const urn = searchParams.get('urn');
  const depth = clampDepth(searchParams.get('depth'));
  // Hooks must run unconditionally; pass null urn when disabled so no fetch fires.
  const graph = useArticleGraph(enabled ? urn : null, depth);

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
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <Network className="h-5 w-5 text-primary-600" />
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Grafo giuridico</h1>
      </header>

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
                layout="cose-bilkent"
                height="100%"
              />
            </Suspense>
          )}
        </main>

        {/* Right column reserved for NodeDetailsDrawer (MERLT-2a.10). */}
        <aside className="hidden w-[300px] shrink-0 border-l border-slate-200 dark:border-slate-800 lg:block" />
      </div>
    </div>
  );
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
