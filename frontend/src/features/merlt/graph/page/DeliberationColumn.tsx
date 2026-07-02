import { useState } from 'react';
import { History, Info, Loader2, MessageSquare, Network, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { AskGraphField } from './AskGraphField';
import { NodeDetailsDrawer } from './NodeDetailsDrawer';
import { EdgeDetailsDrawer } from './EdgeDetailsDrawer';
import { QaHistoryPanel } from '../../qa/QaHistoryPanel';
import { QaSynthesisWithCitations } from '../../ner/QaSynthesisWithCitations';
import { CANON_LABEL, formatRetrievedUrn, provenanceMeta } from '../../qa/format';
import type { QaHistoryItem, QaMode, QaRetrievedSource, QaTurnModel } from '../../qa/types';
import type { GraphEdge, GraphNode } from '../shared/types';

/**
 * Docked dual-tab deliberation column (Slice 4 P1, design §4). Right-hand,
 * ~400px, two tabs of equal dignity:
 *  - **Dibattito**: the absorbed Q&A — the `useQaThread` turns (owned by the
 *    page) rendered as prose + convergent/divergent theses + confidence, each
 *    turn's `retrieved_sources` as provenance-colored chips that re-center the
 *    CANVAS (`onSourceCenter`, not a navigation), a compose field to keep
 *    asking, and a "Cronologia" affordance that opens the server-backed history
 *    (`QaHistoryPanel` → GET /experts/history). The localStorage-hydrated thread
 *    is the CURRENT conversation; the server history is past deliberations,
 *    loaded back into the thread on select via `onLoadHistoryTurn` (both coexist,
 *    exactly as the removed QAPage had — Decision A: history MUST NOT be thrown).
 *  - **Nodo**: the current NodeDetailsDrawer (and EdgeDetailsDrawer when an edge
 *    is selected) — the graph-inspection surface.
 *
 * Presentational: it does NOT own `useQaThread` — the page passes `turns` and
 * the handlers. The teaching channels (rate/prefer/detailed/confirm) are P2
 * (design §5 L2); P1 shows the debate, it does not train the weights.
 */
export interface DeliberationColumnProps {
  activeTab: 'dibattito' | 'nodo';
  onTabChange: (tab: 'dibattito' | 'nodo') => void;
  turns: QaTurnModel[];
  onAsk: (question: string, mode: QaMode) => void;
  onRetry: (turnId: string) => void;
  onCancel: (turnId: string) => void;
  /** Re-center the canvas on a consulted source (node_id preferred, else urn). */
  onSourceCenter: (nodeIdOrUrn: string) => void;
  /**
   * Load a past server-side deliberation into the thread (Decision A — history
   * preserved in the deliberation column). Absent → the "Cronologia" affordance
   * is hidden (the column stays purely current-thread).
   */
  onLoadHistoryTurn?: (item: QaHistoryItem) => void;
  selectedNode?: GraphNode | null;
  selectedEdge?: GraphEdge | null;
  /** Full consent (D2): enables in-prose NER feedback in the synthesis. */
  canContribute: boolean;
  /** Asking unlocked (consent ≥ basic): the compose field is live. */
  qaAskable: boolean;
  /** Edge inspection needs the node map to resolve endpoints; empty when unused. */
  nodesById?: Map<string, GraphNode>;
  edges?: GraphEdge[];
  onRecenter?: (node: GraphNode) => void;
  onCloseNode?: () => void;
}

function confidenceLabel(c: number): string {
  if (c >= 0.75) return 'alta';
  if (c >= 0.5) return 'media';
  return 'bassa';
}

export function DeliberationColumn({
  activeTab,
  onTabChange,
  turns,
  onAsk,
  onRetry,
  onCancel,
  onSourceCenter,
  onLoadHistoryTurn,
  selectedNode,
  selectedEdge,
  canContribute,
  qaAskable,
  nodesById,
  edges = [],
  onRecenter,
  onCloseNode,
}: DeliberationColumnProps): React.ReactElement {
  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Tab header — Dibattito / Nodo, equal dignity (design §C). */}
      <div
        role="tablist"
        aria-label="Colonna di deliberazione"
        className="flex shrink-0 border-b border-slate-200 dark:border-slate-800"
      >
        <TabButton
          active={activeTab === 'dibattito'}
          onClick={() => onTabChange('dibattito')}
          icon={<MessageSquare size={15} />}
          label="Dibattito"
        />
        <TabButton
          active={activeTab === 'nodo'}
          onClick={() => onTabChange('nodo')}
          icon={<Network size={15} />}
          label="Nodo"
        />
      </div>

      {activeTab === 'dibattito' ? (
        <DibattitoTab
          turns={turns}
          onAsk={onAsk}
          onRetry={onRetry}
          onCancel={onCancel}
          onSourceCenter={onSourceCenter}
          onLoadHistoryTurn={onLoadHistoryTurn}
          canContribute={canContribute}
          qaAskable={qaAskable}
          centerLabel={selectedNode?.label}
          centerUrn={selectedNode?.urn ?? undefined}
        />
      ) : (
        <NodoTab
          selectedNode={selectedNode ?? null}
          selectedEdge={selectedEdge ?? null}
          nodesById={nodesById ?? new Map()}
          edges={edges}
          onRecenter={onRecenter}
          onClose={onCloseNode}
        />
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
        active
          ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400'
          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function DibattitoTab({
  turns,
  onAsk,
  onRetry,
  onCancel,
  onSourceCenter,
  onLoadHistoryTurn,
  canContribute,
  qaAskable,
  centerLabel,
  centerUrn,
}: {
  turns: QaTurnModel[];
  onAsk: (question: string, mode: QaMode) => void;
  onRetry: (turnId: string) => void;
  onCancel: (turnId: string) => void;
  onSourceCenter: (nodeIdOrUrn: string) => void;
  onLoadHistoryTurn?: (item: QaHistoryItem) => void;
  canContribute: boolean;
  qaAskable: boolean;
  centerLabel?: string;
  centerUrn?: string;
}): React.ReactElement {
  // "Cronologia" toggle: reveals the server-backed QaHistoryPanel over the thread
  // (Decision A). Selecting a past item loads it into the thread and closes the
  // panel so the loaded turn is immediately visible in the current conversation.
  const [showHistory, setShowHistory] = useState(false);
  const canShowHistory = Boolean(onLoadHistoryTurn);

  const handleSelectHistory = (item: QaHistoryItem): void => {
    onLoadHistoryTurn?.(item);
    setShowHistory(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sub-header: "Cronologia" entry point into the server-side history. */}
      {canShowHistory && (
        <div className="flex shrink-0 items-center justify-end border-b border-slate-100 px-3 py-1.5 dark:border-slate-800/60">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              showHistory
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
            )}
          >
            {showHistory ? <X size={13} /> : <History size={13} />}
            {showHistory ? 'Chiudi cronologia' : 'Cronologia'}
          </button>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {showHistory && canShowHistory ? (
          <QaHistoryPanel onSelect={handleSelectHistory} />
        ) : turns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Nessuna deliberazione. Chiedi al grafo per aprire il dibattito sul nodo al centro.
          </p>
        ) : (
          turns.map((turn) => (
            <DeliberationTurn
              key={turn.id}
              turn={turn}
              onRetry={() => onRetry(turn.id)}
              onCancel={() => onCancel(turn.id)}
              onSourceCenter={onSourceCenter}
              canContribute={canContribute}
            />
          ))
        )}
      </div>

      {/* Compose field pinned at the bottom of the tab (keeps asking without
          leaving the deliberation). Mirrors the header AskGraphField. */}
      <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
        <AskGraphField
          centerLabel={centerLabel}
          centerUrn={centerUrn}
          disabled={!qaAskable}
          onAsk={onAsk}
        />
      </div>
    </div>
  );
}

/**
 * One deliberation turn: question + prose synthesis (or per-canon theses in
 * divergent mode) + confidence + consulted sources as canvas-centering chips.
 * Loading/error surface the page's onCancel/onRetry. The teaching feedback
 * channels (rating/prefer/detailed/confirm) are intentionally absent in P1.
 */
function DeliberationTurn({
  turn,
  onRetry,
  onCancel,
  onSourceCenter,
  canContribute,
}: {
  turn: QaTurnModel;
  onRetry: () => void;
  onCancel: () => void;
  onSourceCenter: (nodeIdOrUrn: string) => void;
  canContribute: boolean;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[90%] rounded-2xl rounded-tr-sm bg-primary-50 px-3 py-2 text-sm text-primary-900 dark:bg-primary-950/40 dark:text-primary-100">
          {turn.question}
        </p>
      </div>

      {turn.state.status === 'loading' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          <span className="flex items-center gap-2">
            <Loader2 className="animate-spin" size={15} /> Il collegio sta deliberando…
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm font-medium text-slate-500 underline transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Annulla
          </button>
        </div>
      )}

      {turn.state.status === 'error' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30"
        >
          <p className="text-sm text-amber-700 dark:text-amber-400">{turn.state.error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-medium text-amber-800 underline transition-colors hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-300 dark:hover:text-amber-200"
          >
            Riprova
          </button>
        </div>
      )}

      {turn.state.status === 'success' &&
        (() => {
          const a = turn.state.answer;
          const isDivergent = a.mode === 'divergent' && a.alternatives && a.alternatives.length > 0;
          const hasSources = a.retrieved_sources.length > 0;
          return (
            <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              {isDivergent ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tesi a confronto</p>
                  {a.alternatives!.map((alt) => (
                    <div key={alt.expert} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {CANON_LABEL[alt.expert] ?? alt.expert}
                      </span>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{alt.position}</p>
                      {alt.legal_basis.length > 0 && (
                        <p className="mt-1 text-xs text-slate-400">{alt.legal_basis.join(' · ')}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <QaSynthesisWithCitations text={a.synthesis} enabled={canContribute} />
              )}

              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <span>confidenza {confidenceLabel(a.confidence)}</span>
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      a.confidence >= 0.75 ? 'bg-emerald-400' : a.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400',
                    )}
                    style={{ width: `${Math.round(a.confidence * 100)}%` }}
                  />
                </span>
              </div>

              {hasSources && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Fonti consultate ({a.retrieved_sources.length})
                  </p>
                  <ul className="space-y-1.5">
                    {a.retrieved_sources.map((s) => (
                      <DeliberationSourceChip
                        key={s.node_id ?? s.urn}
                        source={s}
                        onCenter={onSourceCenter}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}

/**
 * A consulted source, provenance-colored, that RE-CENTERS the canvas on click
 * (design §3.2 "sources light up as nodes") rather than navigating away like
 * QaSourceChip's `/grafo?urn=` link. Prefers `node_id` (the real graph node)
 * over the urn so the join lands on the exact provisional/seed node.
 */
function DeliberationSourceChip({
  source,
  onCenter,
}: {
  source: QaRetrievedSource;
  onCenter: (nodeIdOrUrn: string) => void;
}): React.ReactElement {
  const meta = provenanceMeta(source.provenance);
  const displayUrn = source.urn.startsWith('live:') && source.source_url ? source.source_url : source.urn;
  const label = formatRetrievedUrn(displayUrn);
  const target = source.node_id ?? source.urn;

  return (
    <li className="relative overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <span className={cn('absolute inset-y-0 left-0 w-1', meta.stripe)} aria-hidden="true" />
      <button
        type="button"
        onClick={() => onCenter(target)}
        title={`Centra il grafo su ${label}`}
        className="flex w-full items-start justify-between gap-2 py-2 pl-4 pr-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:hover:bg-slate-800"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs">
            <span className={meta.chip}>{meta.label}</span>
            {typeof source.trust === 'number' && (
              <span className="text-slate-400">· affidabilità {source.trust.toFixed(2)}</span>
            )}
          </span>
        </span>
        <Info size={13} className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />
      </button>
    </li>
  );
}

function NodoTab({
  selectedNode,
  selectedEdge,
  nodesById,
  edges,
  onRecenter,
  onClose,
}: {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  nodesById: Map<string, GraphNode>;
  edges: GraphEdge[];
  onRecenter?: (node: GraphNode) => void;
  onClose?: () => void;
}): React.ReactElement {
  const recenter = onRecenter ?? (() => {});
  const close = onClose ?? (() => {});

  if (selectedEdge) {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <EdgeDetailsDrawer edge={selectedEdge} nodesById={nodesById} onRecenter={recenter} onClose={close} />
      </div>
    );
  }
  if (selectedNode) {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <NodeDetailsDrawer
          node={selectedNode}
          edges={edges}
          nodesById={nodesById}
          onRecenter={recenter}
          onClose={close}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <Network className="h-8 w-8 text-slate-300 dark:text-slate-600" />
      <p className="max-w-[16rem] text-sm text-slate-500 dark:text-slate-400">
        Seleziona un nodo o una relazione sul grafo per vederne i dettagli.
      </p>
    </div>
  );
}
