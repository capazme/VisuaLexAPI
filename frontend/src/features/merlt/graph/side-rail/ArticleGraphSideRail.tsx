import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useArticleGraph } from '../shared/useArticleGraph';
import { useIngestionJob } from '../shared/useIngestionJob';
import {
  classifyIngestionTriggerError,
  triggerIngestion,
  type IngestionTriggerErrorKind,
} from '../shared/graphApi';
import { CollapseToggle } from './CollapseToggle';
import { useRailFocus, useRailMode } from './useRailPresentation';
import { useReflowReadingColumn } from './useReflowReadingColumn';

const GraphCanvas = lazy(() => import('../shared/GraphCanvas'));

export interface ArticleGraphSideRailProps {
  articleUrn: string | undefined;
  /** Start expanded (desktop / tests). Defaults to collapsed (mobile-safe). */
  defaultOpen?: boolean;
}

// Side rail shows the immediate concept neighbourhood: depth 1, capped small.
const SIDE_RAIL_DEPTH = 1;
const SIDE_RAIL_LIMIT = 25;
// Panel width used for the desktop reflow padding (matches the `w-[340px]` panel).
const RAIL_WIDTH_PX = 340;

/**
 * Collapsible rail showing the focused article's concept neighbourhood.
 *
 * Mounted via the `article_sidebar` plugin slot — which renders once per
 * `ArticleTabContent`. To avoid stacked `fixed` rails when several articles are
 * open (Slice 3 §3.4), a module-level coordinator (`useRailFocus`) elects a
 * single winner bound to the most-recently-focused article; the losers render
 * null. The winner presents responsively (design §3.4):
 *  - desktop ≥1280px: reflows the reading column (no overlay over the text)
 *  - 768–1279px: overlay from the right with a scrim
 *  - <768px: bottom-sheet (~55% height), dismissed by scrim tap
 *
 * When the article is not yet in the graph (empty subgraph) it transparently
 * triggers lazy ingestion and polls until ready (bounded budget), then refetches.
 */
export function ArticleGraphSideRail({
  articleUrn,
  defaultOpen = false,
}: ArticleGraphSideRailProps): React.ReactElement | null {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // A zero-size anchor kept in the normal document flow (the panel/toggle are
  // `fixed`). It lets the reflow hook locate THIS rail's Layout scroll container
  // via `closest('main')`, and lets the focus coordinator tell whether THIS
  // copy is the one currently displayed (NormaCard renders the article twice
  // behind mutually-exclusive `md:hidden` / `hidden md:block` containers).
  const [anchorEl, setAnchorEl] = useState<HTMLSpanElement | null>(null);

  // Single-instance election (only the displayed copy wins) + responsive mode.
  const isWinner = useRailFocus(articleUrn, anchorEl);
  const mode = useRailMode();

  useReflowReadingColumn(anchorEl, isWinner && isOpen && mode === 'reflow', RAIL_WIDTH_PX);

  // Only fetch while the rail is open AND we have a urn.
  const activeUrn = isOpen && articleUrn ? articleUrn : null;
  const graph = useArticleGraph(activeUrn, SIDE_RAIL_DEPTH, SIDE_RAIL_LIMIT);

  const [jobId, setJobId] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<IngestionTriggerErrorKind | null>(null);
  const job = useIngestionJob(jobId);

  // Trigger ingestion once when the subgraph comes back empty. Reset keyed on
  // activeUrn (NOT articleUrn) so closing + reopening the rail on the same
  // article re-arms the trigger instead of getting stuck on a stale ref.
  const triggeredRef = useRef(false);
  useEffect(() => {
    triggeredRef.current = false;
    setJobId(null);
    setTriggerError(null);
  }, [activeUrn]);

  useEffect(() => {
    if (graph.status !== 'success' || graph.data.nodes.length > 0) return;
    if (triggeredRef.current || !articleUrn) return;
    triggeredRef.current = true;
    triggerIngestion(articleUrn)
      .then((r) => setJobId(r.jobId))
      .catch((err: unknown) => setTriggerError(classifyIngestionTriggerError(err)));
    // Keyed on status, not graph.data: data is undefined outside 'success' (so it
    // can't go in deps), it's read at fire time, and triggeredRef guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.status, articleUrn]);

  // Reload the graph when the ingestion job finishes.
  useEffect(() => {
    if (job.status === 'completed') graph.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.status]);

  // Full machine reset: re-arm the trigger and refetch — an empty subgraph
  // then re-enqueues the ingestion (with a fresh polling budget).
  const retryIngestion = (): void => {
    triggeredRef.current = false;
    setJobId(null);
    setTriggerError(null);
    graph.refetch();
  };

  if (!articleUrn) return null;

  // In-flow anchor for the reflow hook + the displayed-copy probe (see anchorEl
  // above). Rendered by every instance so `closest('main')` resolves for the
  // winner and the coordinator can read this copy's `display`. Zero-size and
  // absolutely positioned — NOT `display:none`, otherwise the probe would read
  // every copy as hidden and no rail would ever register.
  const anchor = (
    <span ref={setAnchorEl} aria-hidden className="absolute h-0 w-0 overflow-hidden" />
  );

  // Only the elected winner paints the fixed UI — dedupes stacked rails (§3.4).
  if (!isWinner) return anchor;

  if (!isOpen) {
    return (
      <>
        {anchor}
        <div className="fixed right-0 top-1/2 z-30 -translate-y-1/2">
          <CollapseToggle isOpen={false} onToggle={() => setIsOpen(true)} />
        </div>
      </>
    );
  }

  const body = (
    <>
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Grafo dell&apos;articolo
        </h3>
        <CollapseToggle isOpen onToggle={() => setIsOpen(false)} />
      </header>

      <div className="relative flex-1 overflow-hidden">
        <RailBody
          graph={graph}
          job={job}
          triggerError={triggerError}
          articleUrn={articleUrn}
          onRetryIngestion={retryIngestion}
          onNavigateExplore={() =>
            navigate(`/grafo?urn=${encodeURIComponent(articleUrn)}&depth=2`)
          }
          onNodeNavigate={(urn) => navigate(`/grafo?urn=${encodeURIComponent(urn)}&depth=2`)}
        />
      </div>
    </>
  );

  // Overlay (tablet) and bottom-sheet (mobile) dismiss on scrim tap; the desktop
  // reflow mode has no scrim (the column is pushed, text stays fully visible).
  const showScrim = mode === 'overlay' || mode === 'bottom-sheet';

  return (
    <>
      {anchor}
      {showScrim && (
        <button
          type="button"
          aria-label="Chiudi grafo"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-200"
        />
      )}
      <aside
        className={cn(
          'fixed z-40 flex flex-col border-slate-200 bg-white shadow-xl transition-transform duration-200 dark:border-slate-700 dark:bg-slate-900',
          mode === 'bottom-sheet'
            ? 'inset-x-0 bottom-0 h-[55vh] rounded-t-2xl border-t'
            : 'right-0 top-0 h-full w-[340px] max-w-[90vw] border-l',
        )}
        aria-label="Grafo dell'articolo"
      >
        {body}
      </aside>
    </>
  );
}

interface RailBodyProps {
  graph: ReturnType<typeof useArticleGraph>;
  job: ReturnType<typeof useIngestionJob>;
  triggerError: IngestionTriggerErrorKind | null;
  articleUrn: string;
  onRetryIngestion: () => void;
  onNavigateExplore: () => void;
  onNodeNavigate: (urn: string) => void;
}

function RailBody({
  graph,
  job,
  triggerError,
  onRetryIngestion,
  onNavigateExplore,
  onNodeNavigate,
}: RailBodyProps): React.ReactElement {
  if (graph.status === 'loading' || graph.status === 'idle') {
    return <Skeleton label="Caricamento grafo…" />;
  }

  if (graph.status === 'error') {
    return (
      <Centered>
        <AlertCircle className="h-6 w-6 text-red-500" />
        <p className="text-sm text-slate-600 dark:text-slate-300">Errore nel caricamento del grafo.</p>
        <RetryButton onClick={graph.refetch} />
      </Centered>
    );
  }

  // success
  if (graph.data.nodes.length === 0) {
    // The ingestion trigger itself failed: distinct copy per cause (design §3.4).
    if (triggerError === 'consent') {
      return (
        <Centered>
          <AlertCircle className="h-6 w-6 text-amber-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Per costruire il grafo serve il consenso.
          </p>
          <RetryButton onClick={onRetryIngestion} />
        </Centered>
      );
    }
    // 5xx/network trigger failure OR polling budget/job timeout: MERL-T is
    // unreachable or too slow — never leave the spinner unbounded.
    if (triggerError === 'unavailable' || job.status === 'timeout') {
      return (
        <Centered>
          <AlertCircle className="h-6 w-6 text-red-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Grafo non raggiungibile — riprova più tardi.
          </p>
          <RetryButton onClick={onRetryIngestion} />
        </Centered>
      );
    }
    // A completed job that still yields no nodes means the article isn't
    // indexable — otherwise we'd spin on "indicizzando…" forever.
    if (job.status === 'failed' || job.status === 'completed') {
      return (
        <Centered>
          <AlertCircle className="h-6 w-6 text-amber-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Articolo non indicizzabile nel grafo.
          </p>
        </Centered>
      );
    }
    return <Skeleton label="Sto indicizzando l'articolo nel grafo…" building />;
  }

  const nodeUrnById = new Map(graph.data.nodes.map((n) => [n.id, n.urn ?? null]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <Suspense fallback={<Skeleton label="Caricamento vista…" />}>
          <GraphCanvas
            nodes={graph.elements.nodes}
            edges={graph.elements.edges}
            layout="cose-bilkent"
            height="100%"
            onNodeClick={(id) => {
              const urn = nodeUrnById.get(id);
              if (urn) onNodeNavigate(urn);
            }}
          />
        </Suspense>
      </div>
      <div className="border-t border-slate-200 p-2 dark:border-slate-700">
        <button
          type="button"
          onClick={onNavigateExplore}
          className="w-full rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          Esplora nel grafo
        </button>
      </div>
    </div>
  );
}

function Skeleton({ label, building }: { label: string; building?: boolean }): React.ReactElement {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-3 p-4">
      {building ? (
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      ) : (
        <div className="h-24 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      )}
      <p className="text-center text-xs text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">{children}</div>;
}

function RetryButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      Riprova
    </button>
  );
}
