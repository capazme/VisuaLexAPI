import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Route, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { graphTraversalToElements } from '../shared/graphTraversalElements';
import type { GraphCanvasHandle } from '../shared/GraphCanvas';
import type { GraphTraversalEdge } from '../../qa/types';
import { formatRetrievedUrn } from '../../qa/format';

const GraphCanvas = lazy(() => import('../shared/GraphCanvas'));

/**
 * "Segui il ragionamento sul grafo" — walk-mode sequencer (advisor decision: a
 * DEDICATED, self-contained mini-canvas, not a mutation of the main subgraph
 * canvas — the walk routinely visits nodes never loaded in the current view,
 * e.g. `modalita:*` concept nodes at depth 1-2 around an article, so it cannot
 * be expressed as a highlight over the already-rendered subgraph).
 *
 * Mounted by GraphExplorerPage on the MAIN canvas region (replacing the article
 * subgraph / empty state while a walk is active) — a 60+ edge walk needs the
 * full-width room; the deliberation column's docked ~170px slot was too
 * cramped (user feedback). Fills its container (`height="100%"` on the inner
 * GraphCanvas); the sequencer renders as a FLOATING overlay bar at the bottom
 * of the region rather than a separate flex row, so the canvas gets the whole
 * area. Each step highlights the current edge + both endpoint nodes, pulses
 * the target, and camera-focuses it. The caption groups by iteration for
 * orientation on a dense walk.
 */

const AUTOPLAY_INTERVAL_MS = 1800;

export interface GraphTraversalPlayerProps {
  walk: GraphTraversalEdge[];
  onClose: () => void;
}

export function GraphTraversalPlayer({ walk, onClose }: GraphTraversalPlayerProps): React.ReactElement {
  const { nodes, edges, steps } = useMemo(() => graphTraversalToElements(walk), [walk]);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<GraphCanvasHandle | null>(null);
  const total = steps.length;
  const current = total > 0 ? steps[Math.min(stepIndex, total - 1)] : null;

  // Radial layout center: the walk's seed (max out-degree — see
  // graphTraversalToElements), falling back to the first step's source.
  const seedId = useMemo<string | undefined>(() => {
    const seedNode = nodes.find((n) => (n.data as { isSeed?: boolean } | undefined)?.isSeed === true);
    return (seedNode?.id as string | undefined) ?? steps[0]?.sourceId;
  }, [nodes, steps]);

  const goTo = useCallback(
    (index: number): void => {
      const clamped = Math.max(0, Math.min(total - 1, index));
      setStepIndex(clamped);
    },
    [total],
  );
  const next = useCallback((): void => goTo(stepIndex + 1), [goTo, stepIndex]);
  const back = useCallback((): void => goTo(stepIndex - 1), [goTo, stepIndex]);

  // Autoplay: advances one step every AUTOPLAY_INTERVAL_MS. Reaching the last
  // step simply stops SCHEDULING further advances (no setState-in-effect) —
  // `atLastStep` below derives the visual "stopped" state for the Play/Pause
  // button and re-arms a fresh `playing` toggle without ever auto-flipping it.
  const atLastStep = stepIndex >= total - 1;
  useEffect(() => {
    if (!playing || atLastStep) return;
    const id = window.setTimeout(() => setStepIndex((i) => Math.min(total - 1, i + 1)), AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [playing, atLastStep, total]);

  // Camera focus follows the step (best-effort — no-op if the target isn't
  // laid out yet; GraphCanvas.focusNode chains on its own render promise).
  useEffect(() => {
    if (current) canvasRef.current?.focusNode(current.targetId, { select: false });
  }, [current]);

  const highlightNodeIds = useMemo<ReadonlySet<string> | null>(
    () => (current ? new Set([current.sourceId, current.targetId]) : null),
    [current],
  );
  const highlightEdgeIds = useMemo<ReadonlySet<string> | null>(
    () => (current ? new Set([current.edgeId]) : null),
    [current],
  );

  if (total === 0) return <></>;

  return (
    <div className="relative h-full w-full">
      <Suspense fallback={<div className="h-full w-full animate-pulse bg-slate-100 dark:bg-slate-800" />}>
        <GraphCanvas
          ref={canvasRef}
          nodes={nodes}
          edges={edges}
          height="100%"
          layout="radial"
          layoutFocusNodeId={seedId}
          highlightNodeIds={highlightNodeIds}
          highlightEdgeIds={highlightEdgeIds}
        />
      </Suspense>

      {/* Floating overlay control bar (design brief: the canvas gets the full
          region; the sequencer sits ON TOP, bottom-anchored, so it never
          shrinks the graph). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
        <div className="pointer-events-auto flex max-w-full flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <p className="max-w-xl truncate text-xs text-slate-500 dark:text-slate-400">
            <Route size={12} className="mr-1 inline-block shrink-0 text-primary-600" aria-hidden="true" />
            passo {stepIndex + 1}/{total}
            {current && (
              <>
                {' — '}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {formatRetrievedUrn(current.sourceId)}
                </span>
                {' —['}
                <span className="text-primary-600 dark:text-primary-400">{current.relationType}</span>
                {']→ '}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {formatRetrievedUrn(current.targetId)}
                </span>
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={back}
              disabled={stepIndex === 0}
              aria-label="Passo precedente"
              title="Passo precedente"
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              disabled={atLastStep && !playing}
              aria-label={playing && !atLastStep ? 'Pausa' : 'Riproduci'}
              title={playing && !atLastStep ? 'Pausa' : 'Riproduci'}
              className={cn(
                'rounded-md border p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40',
                playing && !atLastStep
                  ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {playing && !atLastStep ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              type="button"
              onClick={next}
              disabled={stepIndex >= total - 1}
              aria-label="Passo successivo"
              title="Passo successivo"
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronRight size={16} />
            </button>
            <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi il replay del ragionamento"
              title="Chiudi il replay"
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
