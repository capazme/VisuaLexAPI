import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, History, Info, Loader2, Lock, MessageSquare, Network, PanelRightClose, PanelRightOpen, Route, Scale, Sprout, Swords, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { SearchParams } from '../../../../types';
import { useRailMode } from '../side-rail/useRailPresentation';
import { AskGraphField, type ContextChip } from './AskGraphField';
import { MobileDeliberationSheet } from './MobileDeliberationSheet';
import { NodeDetailsDrawer } from './NodeDetailsDrawer';
import { EdgeDetailsDrawer } from './EdgeDetailsDrawer';
import { QaHistoryPanel } from '../../qa/QaHistoryPanel';
import { QaSynthesisWithCitations } from '../../ner/QaSynthesisWithCitations';
import { normRefToSearchParams } from '../../validate/provenance';
import { CANON_LABEL, sourceLabel, provenanceMeta, urnKind, toolLabel, formatRetrievedUrn } from '../../qa/format';
import type {
  ConfirmState,
  GraphTraversalEdge,
  QaAnswer,
  QaDisagreementAnalysis,
  QaHistoryItem,
  QaMode,
  QaReactStep,
  QaRetrievedSource,
  QaToolUsage,
  QaTurnModel,
} from '../../qa/types';
import { CANON_STYLE } from '../shared/graphDeliberation';
import { humanizeEdgeType } from '../shared/graphStyles';
import { sourceMatchesNode } from './sourceGraphLink';
import type {
  ExpertContribution,
  GraphEdge,
  GraphEdgeSelection,
  GraphNode,
} from '../shared/types';

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
  /** Submit a question. The page owns the context basket and reads it at ask time. */
  onAsk: (question: string, mode: QaMode) => void;
  /** Context basket chips (nodes-as-context) shown above the composer. */
  contextItems?: ContextChip[];
  /** Remove one node from the context basket. */
  onRemoveContext?: (id: string) => void;
  /** Add the inspected node to the context basket (surfaced in the Nodo drawer). */
  onAddToContext?: (node: GraphNode) => void;
  /** Ids currently in the basket — drives the drawer's "Nel contesto" state. */
  contextIds?: ReadonlySet<string>;
  onRetry: (turnId: string) => void;
  onCancel: (turnId: string) => void;
  /** Re-center the canvas on a consulted source (node_id preferred, else urn). */
  onSourceCenter: (nodeIdOrUrn: string) => void;
  /**
   * Audit item 3a: hovering a source chip pulses the matching canvas node
   * WITHOUT navigating or switching tabs (non-destructive companion to
   * `onSourceCenter`'s explicit click). `null` clears the pulse on mouse-leave.
   * Absent → the chips render without hover wiring (no dead handler calls).
   */
  onSourceHover?: (nodeIdOrUrn: string | null) => void;
  /**
   * "Apri" (feature 3, quick-open): open a cited/consulted norma in the
   * VisuaLex reader (navigate('/') + triggerSearch — the page owns Router/store
   * access). Absent → the "Apri la norma" affordance hides on every source chip.
   */
  onOpenNorm?: (params: SearchParams) => void;
  /**
   * MARQUEE feature: "Segui il ragionamento sul grafo". The walk-mode player
   * moved OUT of this column onto the page's MAIN canvas (the left region has
   * the room 65-edge walks need; the column's own ~170px slot was cramped).
   * The button here stays (disabled+tooltip when the turn carries no walk) but
   * now hands the edges UP via this callback instead of mounting
   * `GraphTraversalPlayer` inline. Defaults to a no-op so existing tests/pages
   * that don't wire it still render (the button becomes inert, never a throw).
   */
  onFollowReasoning?: (edges: GraphTraversalEdge[]) => void;
  /**
   * Load a past server-side deliberation into the thread (Decision A — history
   * preserved in the deliberation column). Absent → the "Cronologia" affordance
   * is hidden (the column stays purely current-thread).
   */
  onLoadHistoryTurn?: (item: QaHistoryItem) => void;
  /**
   * Wave C (gap C1): inline 👍/👎 on an answer (`useQaThread.rate`). Basic-consent
   * feedback (like ask), NOT gated on `canContribute` — absent → the control hides.
   */
  onRate?: (turnId: string, traceId: string, rating: 1 | 5) => void;
  /** Wave C: per-source relevance feedback (`useQaThread.rateSrc`). */
  onRateSource?: (traceId: string, sourceId: string, relevant: boolean) => void;
  /** Wave C: the 3-dimension detailed assessment (`useQaThread.detailed`). */
  onDetailed?: (
    traceId: string,
    scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number },
  ) => void;
  /** Wave C (gap C1): "ricorda nel grafo" confirm-source (`useQaThread.confirm`). */
  onConfirmSource?: (turnId: string, source: QaRetrievedSource) => void;
  selectedNode?: GraphNode | null;
  /**
   * Slice 4 P2a — the current canvas edge selection (discriminated union from
   * FE-canvas via `resolveEdgeSelection`). `kind:'relation'` opens the built
   * EdgeDetailsDrawer; `kind:'contrast'` opens the per-conflict view. Null → the
   * Nodo tab falls back to the node drawer / empty hint.
   */
  selectedEdge?: GraphEdgeSelection | null;
  /**
   * Slice 4 P2a — per-canon full theses for the CURRENT deliberation (from the
   * page's `readDeliberation(latestAnswer)`), used as a fallback when a turn's own
   * `answer.expert_contributions` is absent (e.g. a history-loaded turn). Each
   * turn primarily renders from its OWN answer; this keeps the canvas and the
   * column reading the same contributions.
   */
  expertContributions?: ExpertContribution[];
  /** Full consent (D2): enables in-prose NER feedback in the synthesis. */
  canContribute: boolean;
  /**
   * Slice 4 P2b (L2, design §5) — "pesa di più questo canone". Fires the EXISTING
   * preference feedback channel (`useQaThread.prefer` → `/experts/feedback/preference`)
   * carrying the turn's `trace_id` + the chosen canon; the MERL-T side turns it into a
   * real per-expert gating gradient (authority-weighted). Absent → the steer control
   * is hidden. Gated on `canContribute`: when the user lacks full consent the row
   * renders a compact upsell instead of a dead button.
   */
  onPreferCanon?: (traceId: string, expert: string) => void;
  /**
   * Slice 4 L3 (design §5 "teach-the-weights") — "privilegia questa relazione".
   * Bound by the PAGE to the LATEST settled deliberation's `trace_id` and the NEW
   * relation feedback channel (POST /experts/feedback/relation), so one click on a
   * selected edge becomes a traversal-head gradient with the edge's relation type
   * as target identity. Absent (no settled trace) → the edge steer control is
   * hidden entirely: steering needs a deliberation to attach to. Consent is
   * enforced INSIDE the control (`canContribute` → live button; otherwise the
   * compact upsell), mirroring the canon steer.
   */
  onPreferRelation?: (relationType: string) => void;
  /** Open the consent dialog from the steer upsell shown when !canContribute. */
  onOpenConsent?: () => void;
  /** Asking unlocked (consent ≥ basic): the compose field is live. */
  qaAskable: boolean;
  /** P1.10: a deliberation is in flight — the composer's submit is disabled. */
  askBusy?: boolean;
  /**
   * Defect #4: a turn settled while the user was inspecting the Nodo tab — pulse
   * the Dibattito tab so the arrival is visible. The page clears it on tab switch.
   */
  dibattitoBadge?: boolean;
  /**
   * Defect #10: the active deliberation belongs to ANOTHER center. Renders a
   * compact chip at the top of the Dibattito tab with a "Torna" recenter action.
   */
  scopeChip?: { label: string; onReturn: () => void } | null;
  /**
   * Defect #5: a canon star was clicked on the canvas — expand + scroll to that
   * canon's thesis in the LATEST turn. The nonce re-arms the scroll when the same
   * canon is clicked twice.
   */
  canonFocus?: { key: string; nonce: number } | null;
  /** Edge inspection needs the node map to resolve endpoints; empty when unused. */
  nodesById?: Map<string, GraphNode>;
  edges?: GraphEdge[];
  onRecenter?: (node: GraphNode) => void;
  onCloseNode?: () => void;
  /**
   * Wave 2 UX: desktop collapse of the docked column. `collapsed` renders a thin
   * rail (the canvas reclaims the width); `onToggleCollapse` flips it. Both are
   * ignored in the mobile bottom-sheet presentation — collapse is a desktop-only
   * affordance (mobile already has its own open/close).
   */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function confidenceLabel(c: number): string {
  if (c >= 0.75) return 'alta';
  if (c >= 0.5) return 'media';
  return 'bassa';
}

/** Chip colour matching {@link confidenceLabel}'s three bands. */
function confidenceChipClass(c: number): string {
  if (c >= 0.75) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
  if (c >= 0.5) return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
  return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300';
}

/**
 * Audit item 5 — compact one-line summary of a PAST (non-last) turn's status,
 * shown in the {@link PastTurnRow} `<summary>` (always visible regardless of
 * the disclosure's open state, native `<details>` semantics).
 */
function PastTurnSummary({ turn }: { turn: QaTurnModel }): React.ReactElement {
  if (turn.state.status === 'loading') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Loader2 size={13} className="shrink-0 animate-spin text-slate-400" aria-hidden="true" />
        <span className="truncate text-sm text-slate-600 dark:text-slate-300">{turn.question}</span>
      </span>
    );
  }
  if (turn.state.status === 'error') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm text-slate-600 dark:text-slate-300">{turn.question}</span>
        <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">errore</span>
      </span>
    );
  }
  // Async progressive Q&A: in practice only the LAST turn is ever 'partial'
  // (rendered directly by the caller, never wrapped in PastTurnRow) — this
  // branch exists purely so the type-narrow below is exhaustive.
  if (turn.state.status === 'partial') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Loader2 size={13} className="shrink-0 animate-spin text-slate-400" aria-hidden="true" />
        <span className="truncate text-sm text-slate-600 dark:text-slate-300">{turn.question}</span>
      </span>
    );
  }
  const { synthesis, confidence } = turn.state.answer;
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{turn.question}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">{synthesis}</span>
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            confidenceChipClass(confidence),
          )}
        >
          {confidenceLabel(confidence)}
        </span>
      </span>
    </span>
  );
}

/**
 * Audit item 5 — a PAST turn collapses to a compact question + one-line
 * synthesis + confidence chip, expandable on click/keyboard (native
 * `<details>`/`<summary>`, same idiom as the rest of this column — e.g.
 * "Fonti consultate", "Come ha ragionato"). Only the LAST turn (rendered
 * directly by the caller, never wrapped here) stays expanded by default.
 */
function PastTurnRow({ turn, children }: { turn: QaTurnModel; children: React.ReactNode }): React.ReactElement {
  return (
    <details
      data-past-turn={turn.id}
      className="group rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
        <PastTurnSummary turn={turn} />
        <ChevronDown
          size={14}
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-slate-100 p-3 dark:border-slate-800">{children}</div>
    </details>
  );
}

/** Fixed art. 12 preleggi order; extra experts (rare) keep their reported order last. */
const CANON_ORDER = ['literal', 'systemic', 'principles', 'precedent'];

/**
 * Order the per-canon contributions in the art. 12 preleggi sequence
 * (Letterale → Sistematico → Principî → Precedente), any extra expert last.
 */
function orderContributions(contributions: ExpertContribution[]): ExpertContribution[] {
  return [...contributions].sort((a, b) => {
    const ia = CANON_ORDER.indexOf(a.expert);
    const ib = CANON_ORDER.indexOf(b.expert);
    return (ia === -1 ? CANON_ORDER.length : ia) - (ib === -1 ? CANON_ORDER.length : ib);
  });
}

/**
 * A canon that failed to argue carries its error in the `thesis` string with
 * `confidence === 0` (MERL-T base.py:1366-1396 → "Errore durante l'analisi: …"
 * or "AI service non configurato"). We surface this as a subdued
 * "non ha argomentato" state, never a scary red error — the other canons still
 * deliberated. Heuristic on the FULL text: an Italian error prefix, not a
 * mid-sentence "errore".
 */
function isErroredThesis(thesis: string): boolean {
  const t = thesis.trim().toLowerCase();
  if (t.length === 0) return true;
  return t.startsWith('errore durante') || t.startsWith('ai service non configurato');
}

export function DeliberationColumn({
  activeTab,
  onTabChange,
  turns,
  onAsk,
  contextItems,
  onRemoveContext,
  onAddToContext,
  contextIds,
  onRetry,
  onCancel,
  onSourceCenter,
  onSourceHover,
  onOpenNorm,
  onFollowReasoning,
  onLoadHistoryTurn,
  onRate,
  onRateSource,
  onDetailed,
  onConfirmSource,
  selectedNode,
  selectedEdge,
  expertContributions,
  canContribute,
  onPreferCanon,
  onPreferRelation,
  onOpenConsent,
  qaAskable,
  askBusy = false,
  dibattitoBadge = false,
  scopeChip,
  canonFocus,
  nodesById,
  edges = [],
  onRecenter,
  onCloseNode,
  collapsed = false,
  onToggleCollapse,
}: DeliberationColumnProps): React.ReactElement {
  // Wave 2 mobile: below md the page hides the docked wrapper (`hidden
  // md:block`), which made answers unreachable while asking stayed possible.
  // Reuse the side-rail's breakpoint model: <768px → bottom-sheet presentation.
  const isMobile = useRailMode() === 'bottom-sheet';
  // Collapse is a desktop-only affordance; the mobile bottom-sheet owns its own
  // open/close. `canCollapse` gates both the tab-header collapse button and the
  // rail, so the shared `inner` never grows a stray control on mobile.
  const canCollapse = !isMobile && Boolean(onToggleCollapse);

  // Wave 2 steer idempotency (review P2.7): the steer confirmations are COLUMN
  // state keyed `(channel|traceId|target)` — the previous component-local state
  // was lost on remount (history toggle, edge re-select, sheet close), visually
  // re-arming an already-sent steer and inviting duplicate teaching POSTs (the
  // BFF dedupes too — defence in depth).
  const [steeredKeys, setSteeredKeys] = useState<ReadonlySet<string>>(new Set());
  const markSteered = useCallback((key: string): void => {
    setSteeredKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  // The relation steer keys on the LATEST settled trace — the same trace_id the
  // page binds into `onPreferRelation` — so a NEW deliberation re-arms the edge
  // steer while the same (trace, relation) pair stays confirmed.
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
  const latestTraceId = lastTurn?.state.status === 'success' ? lastTurn.state.answer.trace_id : null;

  // 'partial' is still an in-flight deliberation (no synthesis/confidence yet)
  // — only 'success'/'error' count as settled for the "new turn while closed" pulse.
  const settledCount = turns.filter((t) => t.state.status === 'success' || t.state.status === 'error').length;

  const inner = (
    <>
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
          badge={dibattitoBadge}
        />
        <TabButton
          active={activeTab === 'nodo'}
          onClick={() => onTabChange('nodo')}
          icon={<Network size={15} />}
          label="Nodo"
        />
        {canCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Comprimi il pannello del dibattito"
            title="Comprimi il pannello"
            className="flex shrink-0 items-center px-2.5 text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:hover:text-slate-200"
          >
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Both tabs stay MOUNTED and toggle via CSS (defect #4): unmounting the
          inactive tab caused a visible drawer flash on every switch and lost the
          composer draft / drawer scroll position. */}
      <div
        role="tabpanel"
        aria-label="Dibattito"
        className={cn(activeTab === 'dibattito' ? 'flex' : 'hidden', 'min-h-0 flex-1 flex-col')}
      >
        <DibattitoTab
          turns={turns}
          onAsk={onAsk}
          contextItems={contextItems}
          onRemoveContext={onRemoveContext}
          onRetry={onRetry}
          onCancel={onCancel}
          onSourceCenter={onSourceCenter}
          onSourceHover={onSourceHover}
          onOpenNorm={onOpenNorm}
          onFollowReasoning={onFollowReasoning}
          onLoadHistoryTurn={onLoadHistoryTurn}
          onRate={onRate}
          onRateSource={onRateSource}
          onDetailed={onDetailed}
          onConfirmSource={onConfirmSource}
          expertContributions={expertContributions}
          canContribute={canContribute}
          onPreferCanon={onPreferCanon}
          onOpenConsent={onOpenConsent}
          qaAskable={qaAskable}
          askBusy={askBusy}
          scopeChip={scopeChip}
          canonFocus={canonFocus}
          steeredKeys={steeredKeys}
          onMarkSteered={markSteered}
          selectedNode={selectedNode ?? null}
        />
      </div>
      <div
        role="tabpanel"
        aria-label="Nodo"
        className={cn(activeTab === 'nodo' ? 'flex' : 'hidden', 'min-h-0 flex-1 flex-col')}
      >
        <NodoTab
          selectedNode={selectedNode ?? null}
          selectedEdge={selectedEdge ?? null}
          nodesById={nodesById ?? new Map()}
          edges={edges}
          canContribute={canContribute}
          onPreferRelation={onPreferRelation}
          onOpenConsent={onOpenConsent}
          steeredKeys={steeredKeys}
          onMarkSteered={markSteered}
          latestTraceId={latestTraceId}
          onRecenter={onRecenter}
          onClose={onCloseNode}
          onAddToContext={onAddToContext}
          contextIds={contextIds}
        />
      </div>
    </>
  );

  if (isMobile) {
    return (
      <MobileDeliberationSheet
        badge={dibattitoBadge}
        settledCount={settledCount}
        // Opening the sheet counts as seeing the debate: the page's switchTab
        // clears the pulse badge when landing on the Dibattito tab.
        onOpen={() => onTabChange(activeTab)}
      >
        {inner}
      </MobileDeliberationSheet>
    );
  }

  if (collapsed) {
    return <CollapsedRail onExpand={onToggleCollapse ?? (() => {})} badge={dibattitoBadge} />;
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {inner}
    </aside>
  );
}

/**
 * Wave 2 UX: the collapsed desktop rail. The whole strip is the expand affordance
 * (reclaiming ~360px of canvas); a pulse dot signals a deliberation that settled
 * while the panel was collapsed. Never reached on mobile (bottom-sheet instead).
 */
function CollapsedRail({
  onExpand,
  badge,
}: {
  onExpand: () => void;
  badge: boolean;
}): React.ReactElement {
  return (
    <aside className="h-full w-full border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Espandi il pannello del dibattito"
        title="Espandi il dibattito"
        className="flex h-full w-full flex-col items-center gap-3 py-3 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <span className="relative">
          <PanelRightOpen size={18} aria-hidden="true" />
          {badge && (
            <span className="absolute -right-1 -top-1 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" aria-hidden="true" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" aria-hidden="true" />
              <span className="sr-only">nuova risposta</span>
            </span>
          )}
        </span>
        <span className="text-xs font-medium tracking-wide [writing-mode:vertical-rl]">Dibattito</span>
      </button>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Pulse dot: something arrived in this tab while another one was active. */
  badge?: boolean;
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
      {badge && (
        <span className="relative ml-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" aria-hidden="true" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" aria-hidden="true" />
          <span className="sr-only">nuova risposta</span>
        </span>
      )}
    </button>
  );
}

function DibattitoTab({
  turns,
  onAsk,
  contextItems,
  onRemoveContext,
  onRetry,
  onCancel,
  onSourceCenter,
  onSourceHover,
  onOpenNorm,
  onFollowReasoning,
  onLoadHistoryTurn,
  onRate,
  onRateSource,
  onDetailed,
  onConfirmSource,
  expertContributions,
  canContribute,
  onPreferCanon,
  onOpenConsent,
  qaAskable,
  askBusy = false,
  scopeChip,
  canonFocus,
  steeredKeys,
  onMarkSteered,
  selectedNode,
}: {
  turns: QaTurnModel[];
  onAsk: (question: string, mode: QaMode) => void;
  contextItems?: ContextChip[];
  onRemoveContext?: (id: string) => void;
  onRetry: (turnId: string) => void;
  onCancel: (turnId: string) => void;
  onSourceCenter: (nodeIdOrUrn: string) => void;
  onSourceHover?: (nodeIdOrUrn: string | null) => void;
  onOpenNorm?: (params: SearchParams) => void;
  onFollowReasoning?: (edges: GraphTraversalEdge[]) => void;
  onLoadHistoryTurn?: (item: QaHistoryItem) => void;
  onRate?: (turnId: string, traceId: string, rating: 1 | 5) => void;
  onRateSource?: (traceId: string, sourceId: string, relevant: boolean) => void;
  onDetailed?: (
    traceId: string,
    scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number },
  ) => void;
  onConfirmSource?: (turnId: string, source: QaRetrievedSource) => void;
  expertContributions?: ExpertContribution[];
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
  qaAskable: boolean;
  askBusy?: boolean;
  scopeChip?: { label: string; onReturn: () => void } | null;
  canonFocus?: { key: string; nonce: number } | null;
  steeredKeys: ReadonlySet<string>;
  onMarkSteered: (key: string) => void;
  /** Audit item 3b: the CURRENT canvas node selection — drives the reverse
   *  selection→source link (scroll + highlight the matching chip below). */
  selectedNode?: GraphNode | null;
}): React.ReactElement {
  const lastTurnId = turns.length > 0 ? turns[turns.length - 1].id : null;
  // "Cronologia" toggle: reveals the server-backed QaHistoryPanel over the thread
  // (Decision A). Selecting a past item loads it into the thread and closes the
  // panel so the loaded turn is immediately visible in the current conversation.
  const [showHistory, setShowHistory] = useState(false);
  const canShowHistory = Boolean(onLoadHistoryTurn);
  const turnsRef = useRef<HTMLDivElement | null>(null);

  // Defect #5: a canon star click on the canvas lands HERE — expand + reveal the
  // matching thesis of the LATEST turn. Imperative DOM sync (the <details> stays
  // uncontrolled; the browser owns subsequent toggles), keyed on the nonce so
  // re-clicking the same canon re-scrolls.
  useEffect(() => {
    if (!canonFocus) return;
    const root = turnsRef.current;
    if (!root) return;
    const matches = root.querySelectorAll<HTMLDetailsElement>(
      `details[data-canon="${canonFocus.key}"]`,
    );
    const target = matches[matches.length - 1];
    if (!target) return;
    target.open = true;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [canonFocus]);

  // Audit item 3b: selecting a node on the canvas that resolves to a consulted
  // source scrolls that source's chip into view (the persistent ring highlight
  // itself is prop-driven — see DeliberationSourceChip's `isSelected`). No-op
  // when the selection has no matching chip currently rendered (resilient to a
  // node not on canvas / not a consulted source).
  useEffect(() => {
    if (!selectedNode) return;
    const root = turnsRef.current;
    if (!root) return;
    const matches = root.querySelectorAll<HTMLElement>('[data-source-node-id],[data-source-urn]');
    const target = [...matches].find(
      (el) =>
        (selectedNode.id && el.dataset.sourceNodeId === selectedNode.id) ||
        (selectedNode.urn && el.dataset.sourceUrn === selectedNode.urn),
    );
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedNode]);

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

      <div ref={turnsRef} className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Defect #10: the deliberation belongs to another center — say so and
            offer the way back instead of silently hiding the overlay. */}
        {scopeChip && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="min-w-0 truncate">Dibattito attivo su {scopeChip.label}</span>
            <button
              type="button"
              onClick={scopeChip.onReturn}
              title={`Torna al centro del dibattito (${scopeChip.label})`}
              className="shrink-0 font-medium underline transition-colors hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-amber-200"
            >
              Torna
            </button>
          </div>
        )}
        {showHistory && canShowHistory ? (
          <QaHistoryPanel onSelect={handleSelectHistory} />
        ) : turns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Nessuna deliberazione. Chiedi al grafo per aprire il dibattito sul nodo al centro.
          </p>
        ) : (
          turns.map((turn) => {
            const body = (
              <DeliberationTurn
                turn={turn}
                onRetry={() => onRetry(turn.id)}
                onCancel={() => onCancel(turn.id)}
                onSourceCenter={onSourceCenter}
                onSourceHover={onSourceHover}
                selectedNode={selectedNode}
                onOpenNorm={onOpenNorm}
                onFollowReasoning={onFollowReasoning}
                onRate={onRate}
                onRateSource={onRateSource}
                onDetailed={onDetailed}
                onConfirmSource={onConfirmSource}
                qaAskable={qaAskable}
                canContribute={canContribute}
                onPreferCanon={onPreferCanon}
                onOpenConsent={onOpenConsent}
                steeredKeys={steeredKeys}
                onMarkSteered={onMarkSteered}
                // The `expertContributions` prop is the CURRENT deliberation's set
                // — only the latest turn falls back to it when its own answer lacks
                // per-canon contributions (a history-loaded turn keeps its own/none).
                fallbackContributions={turn.id === lastTurnId ? expertContributions : undefined}
              />
            );
            // Audit item 5: every NON-last turn renders compact by default (the
            // latest turn drives the graph overlay/highlights and stays fully
            // expanded); a past turn expands on click via native <details>.
            return turn.id === lastTurnId ? (
              <div key={turn.id}>{body}</div>
            ) : (
              <PastTurnRow key={turn.id} turn={turn}>
                {body}
              </PastTurnRow>
            );
          })
        )}
      </div>

      {/* Compose field pinned at the bottom of the tab (keeps asking without
          leaving the deliberation). Shows the context basket; the page reads it
          at ask time. Mirrors the header AskGraphField. */}
      <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
        <AskGraphField
          contextItems={contextItems}
          onRemoveContext={onRemoveContext}
          disabled={!qaAskable}
          busy={askBusy}
          onAsk={onAsk}
        />
      </div>
    </div>
  );
}

/**
 * One deliberation turn: question + prose synthesis + per-canon theses + confidence
 * + consulted sources as canvas-centering chips. Loading/error surface the page's
 * onCancel/onRetry.
 *
 * Wave C (gaps C1/C2/C3): surfaces the deliberation signals MERL-T already
 * computes but the FE never showed — inline 👍/👎 + detailed assessment
 * (`onRate`/`onDetailed`, basic-consent, gated on `qaAskable` not
 * `canContribute`), a "Come ha ragionato" reasoning-trace disclosure
 * (`pipeline_trace`/`pipeline_metrics`), and a dissent banner
 * (`disagreement_analysis`/`disagreement_explanation`). Absent handlers hide
 * their affordance entirely (no dead controls).
 *
 * The per-canon theses read from the turn's OWN `answer.expert_contributions`
 * (each turn deliberated independently); `fallbackContributions` (the CURRENT
 * deliberation from the page) only fills in when the answer omits them.
 */
function DeliberationTurn({
  turn,
  onRetry,
  onCancel,
  onSourceCenter,
  onSourceHover,
  selectedNode,
  onOpenNorm,
  onFollowReasoning,
  onRate,
  onRateSource,
  onDetailed,
  onConfirmSource,
  qaAskable,
  canContribute,
  onPreferCanon,
  onOpenConsent,
  steeredKeys,
  onMarkSteered,
  fallbackContributions,
}: {
  turn: QaTurnModel;
  onRetry: () => void;
  onCancel: () => void;
  onSourceCenter: (nodeIdOrUrn: string) => void;
  onSourceHover?: (nodeIdOrUrn: string | null) => void;
  selectedNode?: GraphNode | null;
  onOpenNorm?: (params: SearchParams) => void;
  onFollowReasoning?: (edges: GraphTraversalEdge[]) => void;
  onRate?: (turnId: string, traceId: string, rating: 1 | 5) => void;
  onRateSource?: (traceId: string, sourceId: string, relevant: boolean) => void;
  onDetailed?: (
    traceId: string,
    scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number },
  ) => void;
  onConfirmSource?: (turnId: string, source: QaRetrievedSource) => void;
  qaAskable: boolean;
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
  steeredKeys: ReadonlySet<string>;
  onMarkSteered: (key: string) => void;
  fallbackContributions?: ExpertContribution[];
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[90%] rounded-2xl rounded-tr-sm bg-primary-50 px-3 py-2 text-sm text-primary-900 dark:bg-primary-950/40 dark:text-primary-100">
          {turn.question}
        </p>
      </div>

      {turn.state.status === 'loading' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
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

      {turn.state.status === 'partial' &&
        (() => {
          const partials = turn.state.partials;
          return (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
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
              {/* Per-canon arrival checklist (contract §"Ordine canoni"): a
                  compact art. 12 preleggi progress readout, live-announced so
                  a screen reader hears each canon land without re-reading the
                  whole row. */}
              <p
                aria-live="polite"
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 dark:text-slate-500"
              >
                {CANON_ORDER.map((key, i) => {
                  const arrived = partials.some((p) => p.expert === key);
                  return (
                    <span key={key} className="flex items-center gap-1">
                      {i > 0 && <span aria-hidden="true">·</span>}
                      <span className={arrived ? 'font-medium text-slate-600 dark:text-slate-300' : undefined}>
                        {CANON_LABEL[key] ?? key}
                      </span>
                      {arrived ? (
                        <Check size={11} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">…</span>
                      )}
                    </span>
                  );
                })}
              </p>
              {partials.length > 0 && (
                <CanonTheses
                  contributions={partials}
                  traceId=""
                  canContribute={canContribute}
                  steeredKeys={steeredKeys}
                  onMarkSteered={onMarkSteered}
                />
              )}
            </div>
          );
        })()}

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
          const hasSources = a.retrieved_sources.length > 0;
          // Per-canon FULL theses (design §3.3): prefer the turn's own answer, fall
          // back to the page's current-deliberation set. When present they REPLACE
          // the flat divergent-only "Tesi a confronto" preview with the real
          // per-canon arguments (they exist in both convergent and divergent runs).
          const contributions =
            a.expert_contributions && a.expert_contributions.length > 0
              ? a.expert_contributions
              : fallbackContributions ?? [];
          const hasContributions = contributions.length > 0;
          // Pre-P2a backward-compat: no contributions but a divergent answer still
          // carries `alternatives` — keep showing those so old responses don't lose
          // the per-canon view.
          const legacyDivergent =
            !hasContributions && a.mode === 'divergent' && Boolean(a.alternatives && a.alternatives.length > 0);
          return (
            <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              {/* The synthesis stays the primary readable prose (design §C). */}
              <QaSynthesisWithCitations text={a.synthesis} enabled={canContribute} />

              {/* Wave 2 (P2.6): hydration state of a history-loaded turn — the
                  slim DTO landed instantly; the full trace details follow (or
                  are gone, in which case we say so instead of hiding it). */}
              {turn.historyDetail === 'loading' && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  Recupero i dettagli della deliberazione…
                </p>
              )}
              {turn.historyDetail === 'unavailable' && (
                <p className="mt-2 text-xs italic text-slate-400 dark:text-slate-500">
                  Dettagli non più disponibili per questa deliberazione.
                </p>
              )}

              {hasContributions ? (
                <CanonTheses
                  contributions={contributions}
                  traceId={a.trace_id}
                  canContribute={canContribute}
                  onPreferCanon={onPreferCanon}
                  onOpenConsent={onOpenConsent}
                  steeredKeys={steeredKeys}
                  onMarkSteered={onMarkSteered}
                />
              ) : legacyDivergent ? (
                <div className="mt-3 space-y-2">
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
              ) : null}

              {/* Wave C (gap C3 + A5-surface): dissent banner. Today only reachable
                  by clicking a canvas contrast arc — surfaced here in the reading
                  flow, near the confidence bar. */}
              {a.disagreement_analysis?.has_disagreement && (
                <DissentBanner disagreement={a.disagreement_analysis} explanation={a.disagreement_explanation} />
              )}

              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>confidenza {confidenceLabel(a.confidence)}</span>
                <span
                  role="meter"
                  aria-label="Livello di confidenza"
                  aria-valuenow={Math.round(a.confidence * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                >
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      a.confidence >= 0.75 ? 'bg-emerald-400' : a.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400',
                    )}
                    style={{ width: `${Math.round(a.confidence * 100)}%` }}
                  />
                </span>
                <span className="text-slate-400 dark:text-slate-500">{a.confidence.toFixed(2)}</span>
              </div>

              {hasSources && (
                // Closed by default: with 8-15 two-line source chips the expanded
                // list is taller than a viewport and buries the feedback controls
                // below. The summary keeps the count visible; feedback stays reachable.
                <details className="mt-3">
                  <summary className="mb-1.5 cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-slate-300">
                    Fonti consultate ({a.retrieved_sources.length})
                  </summary>
                  <ul className="space-y-1.5">
                    {a.retrieved_sources.map((s) => (
                      <DeliberationSourceChip
                        key={s.node_id ?? s.urn}
                        source={s}
                        onCenter={onSourceCenter}
                        onHover={onSourceHover}
                        isSelected={sourceMatchesNode(s, selectedNode)}
                        onOpenNorm={onOpenNorm}
                        onRate={onRateSource ? (relevant) => onRateSource(a.trace_id, s.urn, relevant) : undefined}
                        onConfirm={onConfirmSource ? () => onConfirmSource(turn.id, s) : undefined}
                        confirmState={s.node_id ? turn.confirmed[s.node_id] : undefined}
                      />
                    ))}
                  </ul>
                </details>
              )}

              {/* MARQUEE: "Segui il ragionamento sul grafo" — hands the walk UP
                  to the page (onFollowReasoning), which replays it on the MAIN
                  canvas (see GraphExplorerPage's activeWalk). The button stays
                  here, disabled+tooltip when the turn carries no walk. */}
              <GraphTraversalControl walk={a.graphTraversal ?? []} onFollowReasoning={onFollowReasoning} />

              {/* Reach a SPECIFIC used node fast: the distinct walk nodes as
                  one-click chips that center it on the main canvas (jump, not
                  animation). Fills the gap when retrieved_sources is empty. */}
              <TraversalNodesList
                walk={a.graphTraversal ?? []}
                onCenter={onSourceCenter}
                onHover={onSourceHover}
              />

              {/* Wave C (gap C2): "Come ha ragionato" — pipeline_trace + metrics
                  arrive on every answer but were never rendered. Closed by default. */}
              <ReasoningTraceDisclosure answer={a} toolUsages={a.toolUsages ?? []} reactSteps={a.reactSteps ?? []} />

              {/* Wave C (gap C1): inline 👍/👎 + detailed assessment. Basic-consent
                  feedback (like ask) — gated on qaAskable, NOT canContribute. */}
              {(onRate || onDetailed) && qaAskable && (
                <TurnFeedback
                  turn={turn}
                  traceId={a.trace_id}
                  onRate={onRate}
                  onDetailed={onDetailed}
                />
              )}
            </div>
          );
        })()}
    </div>
  );
}

/**
 * "Il collegio ha dissentito" — Wave C gap C3/A5-surface. Renders only the
 * fields the answer actually carries (intensity/type/level/resolvability are
 * all optional-ish on the wire). The provenance caveat: `source` MAY arrive
 * later; when present and not 'model-trained' the numbers are a heuristic
 * estimate, not ground truth — caveated rather than presented as authoritative.
 */
function DissentBanner({
  disagreement,
  explanation,
}: {
  disagreement: QaDisagreementAnalysis;
  explanation?: string | null;
}): React.ReactElement {
  const { disagreement_type, disagreement_level, intensity, resolvability, source } = disagreement;
  const isHeuristic = Boolean(source) && source !== 'model-trained';
  const suffix = isHeuristic ? ' (stima)' : '';

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
        <Swords size={14} className="shrink-0" aria-hidden="true" />
        Il collegio ha dissentito
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-amber-700 dark:text-amber-400">
        {typeof intensity === 'number' && (
          <span>intensità {intensity.toFixed(2)}{suffix}</span>
        )}
        {disagreement_type && <span>tipo {disagreement_type}</span>}
        {disagreement_level && <span>livello {disagreement_level}</span>}
        {typeof resolvability === 'number' && (
          <span>risolvibilità {resolvability.toFixed(2)}{suffix}</span>
        )}
      </div>
      {explanation && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-xs font-medium text-amber-700 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-amber-400 dark:hover:text-amber-200">
            Perché il collegio dissente
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-xs text-amber-800 dark:text-amber-300">{explanation}</p>
        </details>
      )}
    </div>
  );
}

/** Best-effort narrowing of the loose/evolving pipeline trace + metrics JSON. */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * MARQUEE feature: "Segui il ragionamento sul grafo" trigger. The walk-mode
 * player moved OUT of the column onto the page's MAIN canvas (65-edge walks
 * need the room the docked column's ~170px slot didn't have) — this button is
 * now a stateless trigger that hands the edges UP via `onFollowReasoning`.
 * Disabled with an explanatory tooltip when the answer carries no
 * graph-resolvable walk (the query had no graph-resolvable seed norms) —
 * discoverable rather than silently hidden, per the design brief. Absent
 * `onFollowReasoning` (default no-op on the column's props) → the button
 * still renders but does nothing, so pages that don't wire the main-canvas
 * replay never see a throw.
 */
function GraphTraversalControl({
  walk,
  onFollowReasoning,
}: {
  walk: GraphTraversalEdge[];
  onFollowReasoning?: (edges: GraphTraversalEdge[]) => void;
}): React.ReactElement {
  const hasWalk = walk.length > 0;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => onFollowReasoning?.(walk)}
        disabled={!hasWalk}
        title={hasWalk ? undefined : 'Nessuna traversata sul grafo per questa risposta'}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:disabled:border-slate-700 dark:disabled:bg-slate-800/40 dark:disabled:text-slate-500 dark:disabled:hover:bg-slate-800/40"
      >
        <Route size={13} className="shrink-0" aria-hidden="true" />
        Segui il ragionamento sul grafo
        {!hasWalk && <span className="text-[11px] font-normal italic">(nessun cammino)</span>}
      </button>
    </div>
  );
}

/** DISTINCT nodes the walk touched, in first-seen (path) order — the seed comes
 *  first, then each node as the reasoning reached it. */
function distinctWalkNodes(walk: GraphTraversalEdge[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of walk) {
    for (const n of [e.source_urn, e.target_urn]) {
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

const WALK_NODES_PREVIEW = 12;

/**
 * "Nodi percorsi nel grafo" — the DISTINCT nodes the systemic walk touched, each
 * a one-click jump that CENTERS it on the main canvas (onCenter → the page's
 * handleSourceCenter: focus if already in the subgraph, else re-center + load).
 * Complements GraphTraversalControl (which animates the WHOLE path): this is the
 * "reach a specific used node quickly" affordance that was missing — the answer
 * often walks dozens of nodes while `retrieved_sources` (the only other chip
 * surface) is empty. Rendered only when the walk is non-empty; capped with an
 * expand toggle so a 60-node walk never floods the column.
 */
function TraversalNodesList({
  walk,
  onCenter,
  onHover,
}: {
  walk: GraphTraversalEdge[];
  onCenter: (nodeIdOrUrn: string) => void;
  onHover?: (nodeIdOrUrn: string | null) => void;
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const nodes = distinctWalkNodes(walk);
  if (nodes.length === 0) return null;
  const shown = expanded ? nodes : nodes.slice(0, WALK_NODES_PREVIEW);
  const hidden = nodes.length - shown.length;

  return (
    <details className="mt-3" open>
      <summary className="mb-1.5 cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-slate-300">
        Nodi percorsi nel grafo ({nodes.length})
      </summary>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((node) => {
          const kind = urnKind(node).kind;
          const Icon = kind === 'sentenza' ? Scale : kind === 'norma' ? BookOpen : Network;
          return (
            <li key={node}>
              <button
                type="button"
                onClick={() => onCenter(node)}
                onMouseEnter={onHover ? () => onHover(node) : undefined}
                onMouseLeave={onHover ? () => onHover(null) : undefined}
                title={`Centra «${formatRetrievedUrn(node)}» sul grafo`}
                className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-700 dark:hover:bg-primary-950/40 dark:hover:text-primary-300"
              >
                <Icon size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{formatRetrievedUrn(node)}</span>
              </button>
            </li>
          );
        })}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
            >
              +{hidden} altri
            </button>
          </li>
        )}
      </ul>
    </details>
  );
}

/**
 * "Come ha ragionato" — Wave C gap C2. Closed by default so it never dominates
 * the answer. Adapted from the old QaProcessTrace.tsx (now orphaned): experts
 * activated/skipped, routing method, NER entities, per-stage timings, total
 * tokens, per-canon ReAct steps (real bug fix: MERL-T runs ReAct PER canon,
 * typically 3 iterations each, and the steps live at
 * `pipeline_trace.stages.expert_executions[*].react_steps` — a top-level
 * `trace.react_steps` never existed on the wire, so reading it there always
 * saw `[]` and printed a false "ReAct non attivo" even when ReAct was running).
 */
function ReasoningTraceDisclosure({
  answer,
  toolUsages,
  reactSteps,
}: {
  answer: QaAnswer;
  toolUsages: QaToolUsage[];
  reactSteps: QaReactStep[];
}): React.ReactElement | null {
  const trace = asRecord(answer.pipeline_trace);
  const metrics = asRecord(answer.pipeline_metrics);
  if (!trace && !metrics && toolUsages.length === 0 && reactSteps.length === 0) return null;

  const stageTimes = trace ? asRecord(trace.stage_times_ms) : null;
  const ner = trace ? asRecord(trace.ner_result) : null;
  const routing = trace ? asRecord(trace.routing) : null;
  const nerEntities = ner && Array.isArray(ner.entities) ? (ner.entities as unknown[]) : [];
  const expertsSkipped = trace && Array.isArray(trace.experts_skipped) ? (trace.experts_skipped as unknown[]) : [];
  const totalTokens = metrics?.total_tokens ?? trace?.total_tokens;

  return (
    <details className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:text-slate-200">
        Come ha ragionato
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-3 text-xs dark:border-slate-700">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
          <div className="flex justify-between">
            <dt>Canoni attivati</dt>
            <dd className="font-medium">{answer.experts_used.length}</dd>
          </div>
          {expertsSkipped.length > 0 && (
            <div className="flex justify-between">
              <dt>Canoni saltati</dt>
              <dd className="font-medium">{expertsSkipped.length}</dd>
            </div>
          )}
          {routing?.method != null && (
            <div className="flex justify-between">
              <dt>Metodo di routing</dt>
              <dd className="font-medium">{String(routing.method)}</dd>
            </div>
          )}
          {typeof totalTokens === 'number' && (
            <div className="flex justify-between">
              <dt>Token totali</dt>
              <dd className="font-medium">{totalTokens}</dd>
            </div>
          )}
        </dl>

        {expertsSkipped.length > 0 && (
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Canoni saltati</p>
            <ul className="space-y-0.5">
              {expertsSkipped.map((s, i) => {
                const rec = asRecord(s);
                const expert = rec && typeof rec.expert === 'string' ? rec.expert : String(s);
                const reason = rec && typeof rec.reason === 'string' ? rec.reason : null;
                return (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{CANON_LABEL[expert] ?? expert}</span>
                    {reason && <span className="text-slate-400">{reason}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {nerEntities.length > 0 && (
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">
              Entità NER ({nerEntities.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {nerEntities.map((e, i) => {
                const ent = asRecord(e);
                const text = ent && typeof ent.text === 'string' ? ent.text : JSON.stringify(e);
                const type = ent && typeof ent.type === 'string' ? ent.type : null;
                return (
                  <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {text}
                    {type ? ` · ${type}` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {stageTimes && Object.keys(stageTimes).length > 0 && (
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Tempi per stage (ms)</p>
            <ul className="space-y-0.5">
              {Object.entries(stageTimes).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className="font-mono">{typeof v === 'number' ? Math.round(v) : String(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Passi ReAct</p>
          {reactSteps.length > 0 ? (
            <ReactStepsSection reactSteps={reactSteps} />
          ) : (
            // Genuinely empty (old answer / canons ran single-step) — this is
            // the ONLY place this note may print; it must never fire just
            // because the reader looked at the wrong trace level.
            <p className="italic text-slate-400">Ragionamento a passo singolo (ReAct non attivo).</p>
          )}
        </div>

        {/* "Strumenti usati" — one chip per tool call, grouped by canon, so the
            jurist sees which tool each canon fired and whether it worked before
            giving feedback. */}
        {toolUsages.length > 0 && <ToolUsagesSection toolUsages={toolUsages} />}
      </div>
    </details>
  );
}

/** Per-canon "Strumenti usati": a chip per tool call — green+count on success, red+error tooltip on failure. */
function ToolUsagesSection({ toolUsages }: { toolUsages: QaToolUsage[] }): React.ReactElement {
  const byExpert = new Map<string, QaToolUsage[]>();
  for (const u of toolUsages) {
    const list = byExpert.get(u.expert);
    if (list) list.push(u);
    else byExpert.set(u.expert, [u]);
  }

  return (
    <div>
      <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Strumenti usati</p>
      <div className="space-y-1.5">
        {[...byExpert.entries()].map(([expert, uses]) => (
          <div key={expert} className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">{CANON_LABEL[expert] ?? expert}</span>
            {uses.map((u, i) => (
              <span
                key={`${u.toolName}-${i}`}
                title={u.success ? undefined : (u.error ?? 'Errore non specificato')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                  u.success
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                )}
              >
                {u.success ? (
                  <Check size={10} className="shrink-0" aria-hidden="true" />
                ) : (
                  <X size={10} className="shrink-0" aria-hidden="true" />
                )}
                {toolLabel(u.toolName)}
                {u.success && u.resultCount !== null && <span className="text-emerald-500 dark:text-emerald-400">· {u.resultCount}</span>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A ReAct thought is often long free text — truncated for the compact disclosure row. */
const THOUGHT_TRUNCATE_LEN = 140;
function truncateThought(thought: string): string {
  return thought.length > THOUGHT_TRUNCATE_LEN ? `${thought.slice(0, THOUGHT_TRUNCATE_LEN - 1)}…` : thought;
}

/**
 * Per-canon ReAct iterations — grouped by `expert` (MERL-T runs ReAct PER
 * canon, typically 3 iterations each), each canon showing an "N iterazioni"
 * count and, per iteration, the truncated `thought` + the tool `action` fired
 * + `resultsFound` when the observation reports one. Bug fix: this reads the
 * REAL per-canon `react_steps` (via `QaReactStep[]`, parsed from
 * `expert_executions[*].react_steps`) instead of a non-existent top-level
 * `trace.react_steps` — the previous code always saw `[]` here.
 */
function ReactStepsSection({ reactSteps }: { reactSteps: QaReactStep[] }): React.ReactElement {
  const byExpert = new Map<string, QaReactStep[]>();
  for (const s of reactSteps) {
    const list = byExpert.get(s.expert);
    if (list) list.push(s);
    else byExpert.set(s.expert, [s]);
  }

  return (
    <div className="space-y-2">
      {[...byExpert.entries()].map(([expert, steps]) => (
        <div key={expert}>
          <p className="mb-0.5 flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-600 dark:text-slate-300">{CANON_LABEL[expert] ?? expert}</span>
            <span>· {steps.length} {steps.length === 1 ? 'iterazione' : 'iterazioni'}</span>
          </p>
          <ul className="space-y-0.5 pl-2">
            {steps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
                <span className="shrink-0 text-slate-400">#{s.iteration}</span>
                {s.thought && <span className="text-slate-600 dark:text-slate-300">{truncateThought(s.thought)}</span>}
                {s.action && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                      s.success
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
                    )}
                  >
                    {s.action}
                    {s.success && s.resultsFound !== null && (
                      <span className="text-emerald-500 dark:text-emerald-400">· {s.resultsFound}</span>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const DETAILED_GRADES: { value: 0.3 | 0.6 | 0.9; label: string }[] = [
  { value: 0.3, label: 'scarso' },
  { value: 0.6, label: 'adeguato' },
  { value: 0.9, label: 'ottimo' },
];
const DETAILED_DIMENSIONS: { key: 'retrieval' | 'reasoning' | 'synthesis'; label: string }[] = [
  { key: 'retrieval', label: 'Fonti recuperate' },
  { key: 'reasoning', label: 'Ragionamento' },
  { key: 'synthesis', label: 'Esposizione' },
];

/**
 * Inline 👍/👎 + "Valutazione dettagliata" (Wave C gap C1). Basic-consent
 * feedback (like ask), gated on `qaAskable` — NOT `canContribute` (that's the
 * TEACH ladder for canon/relation steering). Rating reflects `turn.rating`
 * (optimistic, set by useQaThread.rate); the detailed assessment is local
 * component state (fire-and-forget, no server echo to reconcile against).
 */
function TurnFeedback({
  turn,
  traceId,
  onRate,
  onDetailed,
}: {
  turn: QaTurnModel;
  traceId: string;
  onRate?: (turnId: string, traceId: string, rating: 1 | 5) => void;
  onDetailed?: (
    traceId: string,
    scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number },
  ) => void;
}): React.ReactElement {
  const [grades, setGrades] = useState<Record<string, 0.3 | 0.6 | 0.9>>({});
  const [detailedSent, setDetailedSent] = useState(false);
  const allGraded = DETAILED_DIMENSIONS.every((d) => grades[d.key] !== undefined);

  const submitDetailed = (): void => {
    if (!allGraded || !onDetailed) return;
    onDetailed(traceId, {
      retrievalScore: grades.retrieval,
      reasoningScore: grades.reasoning,
      synthesisScore: grades.synthesis,
    });
    setDetailedSent(true);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      {onRate && (
        <>
          <button
            type="button"
            aria-label="Risposta utile"
            aria-pressed={turn.rating === 5}
            onClick={() => onRate(turn.id, traceId, 5)}
            className={cn(
              'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
              turn.rating === 5
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40'
                : 'text-slate-400 hover:text-emerald-600',
            )}
          >
            <ThumbsUp size={15} />
          </button>
          <button
            type="button"
            aria-label="Risposta non utile"
            aria-pressed={turn.rating === 1}
            onClick={() => onRate(turn.id, traceId, 1)}
            className={cn(
              'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500',
              turn.rating === 1
                ? 'bg-red-50 text-red-600 dark:bg-red-950/40'
                : 'text-slate-400 hover:text-red-600',
            )}
          >
            <ThumbsDown size={15} />
          </button>
        </>
      )}

      {onDetailed && (
        <details className="ml-auto w-full sm:w-auto">
          <summary className="cursor-pointer select-none text-xs font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:underline dark:text-primary-400">
            Valutazione dettagliata
          </summary>
          <div className="mt-2 space-y-2">
            {detailedSent ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Grazie, valutazione registrata.</p>
            ) : (
              <>
                {DETAILED_DIMENSIONS.map((d) => (
                  <div key={d.key} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-300">{d.label}</span>
                    <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
                      {DETAILED_GRADES.map((g) => (
                        <button
                          key={g.value}
                          type="button"
                          aria-pressed={grades[d.key] === g.value}
                          onClick={() => setGrades((prev) => ({ ...prev, [d.key]: g.value }))}
                          className={cn(
                            'rounded px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                            grades[d.key] === g.value
                              ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
                          )}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={!allGraded}
                  onClick={submitDetailed}
                  title={allGraded ? undefined : 'Valuta tutte e tre le dimensioni'}
                  className="text-xs font-medium text-primary-600 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-primary-400 dark:disabled:text-slate-600"
                >
                  Invia valutazione
                </button>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Per-canon FULL theses (design §3.3 "each canon claims its sources", §6 P2).
 * Replaces the flat "Tesi a confronto" preview: each canon's full argument, in a
 * canon-colored, individually-expandable section, with its self-confidence and
 * routing weight. Legal lexicon, no gamified bars. A canon that failed to argue
 * renders a subdued "non ha argomentato" — never a scary error.
 */
function CanonTheses({
  contributions,
  traceId,
  canContribute,
  onPreferCanon,
  onOpenConsent,
  steeredKeys,
  onMarkSteered,
}: {
  contributions: ExpertContribution[];
  /** The turn's `trace_id`, threaded to each steer so the gradient targets THIS deliberation. */
  traceId: string;
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
  steeredKeys: ReadonlySet<string>;
  onMarkSteered: (key: string) => void;
}): React.ReactElement {
  const ordered = orderContributions(contributions);
  // The steer affordance appears only when the page wires the preference channel
  // AND the turn has a trace_id to key the feedback on. Consent is enforced INSIDE
  // the item (full → the steer button; otherwise → the compact upsell), so the
  // section itself is unconditional and never a dead surface.
  const steerable = Boolean(onPreferCanon) && traceId.length > 0;
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Le tesi dei canoni</p>
      <div className="space-y-1.5">
        {ordered.map((c) => (
          <CanonThesisItem
            key={c.expert}
            contribution={c}
            traceId={traceId}
            canContribute={canContribute}
            onPreferCanon={steerable ? onPreferCanon : undefined}
            onOpenConsent={onOpenConsent}
            steeredKeys={steeredKeys}
            onMarkSteered={onMarkSteered}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One canon's thesis: a canon-colored leading stripe (matching the canvas canon
 * colours, {@link CANON_STYLE}) + an expandable `<details>` carrying the FULL
 * interpretation and the weight/confidence meta. Errored canons collapse to a
 * subdued, non-expandable "non ha argomentato" row.
 */
function CanonThesisItem({
  contribution,
  traceId,
  canContribute,
  onPreferCanon,
  onOpenConsent,
  steeredKeys,
  onMarkSteered,
}: {
  contribution: ExpertContribution;
  traceId: string;
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
  steeredKeys: ReadonlySet<string>;
  onMarkSteered: (key: string) => void;
}): React.ReactElement {
  const { expert, thesis, confidence, weight } = contribution;
  const label = CANON_LABEL[expert] ?? expert;
  const color = (CANON_STYLE as Record<string, { color: string } | undefined>)[expert]?.color ?? '#475569';
  const errored = isErroredThesis(thesis);
  // Wave 2 P2.7: idempotency key of THIS steer — column-level state, so a
  // remount (history toggle, sheet close) can't re-arm an already-sent steer.
  const steerKey = `canon|${traceId}|${expert}`;

  if (errored) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/30">
        <span className="absolute inset-y-0 left-0 w-1 opacity-40" style={{ backgroundColor: color }} aria-hidden="true" />
        <div className="flex items-center justify-between gap-2 py-2 pl-4 pr-3">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</span>
          <span className="text-xs italic text-slate-400 dark:text-slate-500">non ha argomentato</span>
        </div>
      </div>
    );
  }

  return (
    // data-canon: the canvas canon-star click resolves to this element to expand
    // + scroll it into view (defect #5 — see DibattitoTab's canonFocus effect).
    <details
      data-canon={expert}
      className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} aria-hidden="true" />
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 py-2 pl-4 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            <span>peso {formatCanonPct(weight)}</span>
            <span aria-hidden="true">·</span>
            <span>confidenza {confidenceLabel(confidence)}</span>
          </span>
        </span>
        <ChevronDown
          size={15}
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-slate-100 py-2 pl-4 pr-3 dark:border-slate-800">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">{thesis}</p>
        {onPreferCanon && (
          <CanonSteer
            label={label}
            canContribute={canContribute}
            steered={steeredKeys.has(steerKey)}
            onPrefer={() => {
              onPreferCanon(traceId, expert);
              onMarkSteered(steerKey);
            }}
            onOpenConsent={onOpenConsent}
          />
        )}
      </div>
    </details>
  );
}

/**
 * "Pesa di più questo canone" (design §5 L2 — teach-the-weights). Reuses the
 * EXISTING preference feedback channel (`useQaThread.prefer`): one click fires it
 * optimistically and fire-and-forget, so the jurist's directional steer becomes a
 * real per-expert gating gradient (authority-weighted server-side). The click is
 * scoped inside a `<details>` body — {@link handleClick} stops propagation so it
 * never toggles the disclosure. Copy stays legal-lexicon, no gamification.
 *
 * Wave 2 P2.7: `steered` is CONTROLLED (column-level state keyed on
 * `(traceId, expert)`) — component-local state was lost on remount, re-arming
 * an already-sent steer.
 *
 * Consent gate (D2 / §5): with `full` consent the steer button is live; otherwise
 * a compact upsell replaces it (opening the consent dialog) — never a dead button.
 */
function CanonSteer({
  label,
  canContribute,
  steered,
  onPrefer,
  onOpenConsent,
}: {
  label: string;
  canContribute: boolean;
  steered: boolean;
  onPrefer: () => void;
  onOpenConsent?: () => void;
}): React.ReactElement {
  if (!canContribute) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <Lock size={12} className="shrink-0" aria-hidden="true" />
        <span>Per orientare il collegio serve il consenso completo.</span>
        {onOpenConsent && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenConsent();
            }}
            className="font-medium text-primary-600 transition-colors hover:text-primary-700 focus-visible:underline focus-visible:outline-none dark:text-primary-400"
          >
            Attiva
          </button>
        )}
      </div>
    );
  }

  // Optimistic + fire-and-forget: flip to the confirmation the instant the jurist
  // clicks; the preference POST is issued by the page's handler and its outcome is
  // not surfaced (a failed teach is not worth a scary error — the next deliberation
  // stands on its own).
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onPrefer();
  };

  if (steered) {
    return (
      <p className="mt-2.5 flex items-center gap-1.5 border-t border-slate-100 pt-2.5 text-xs text-emerald-600 dark:border-slate-800 dark:text-emerald-400">
        <Check size={13} className="shrink-0" aria-hidden="true" />
        Terrò conto della tua preferenza.
      </p>
    );
  }

  return (
    <div className="mt-2.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
      <button
        type="button"
        onClick={handleClick}
        title={`Indica al collegio di dare più peso al canone ${label}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-700 dark:hover:bg-primary-950/40 dark:hover:text-primary-300"
      >
        <Scale size={13} className="shrink-0" aria-hidden="true" />
        Pesa di più questo canone
      </button>
    </div>
  );
}

/**
 * "Privilegia questa relazione" (Slice 4 L3 — teach the traversal head). Pinned
 * under the EdgeDetailsDrawer when a REAL relation is selected AND the page has a
 * settled deliberation trace to attach the steer to (the page binds `trace_id`
 * into `onPreferRelation`). One click fires the NEW relation feedback channel
 * (`/experts/feedback/relation`) optimistically and fire-and-forget — the
 * confirmation quotes the relation, stays subtle and legal-lexicon, no
 * gamification. Mirrors {@link CanonSteer}'s consent gate: `full` consent → live
 * button; otherwise the compact upsell (never a dead button).
 *
 * Wave 2 P2.7: `steered` is CONTROLLED (column-level state keyed on
 * `(latestTraceId, relationType)`) — the previous per-edge remount reset the
 * local state, re-arming the button on every re-selection of the same edge.
 */
function RelationSteer({
  relationType,
  canContribute,
  steered,
  onPrefer,
  onOpenConsent,
}: {
  relationType: string;
  canContribute: boolean;
  steered: boolean;
  onPrefer: () => void;
  onOpenConsent?: () => void;
}): React.ReactElement {
  if (!canContribute) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-200 px-3 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <Lock size={12} className="shrink-0" aria-hidden="true" />
        <span>Per orientare il collegio serve il consenso completo.</span>
        {onOpenConsent && (
          <button
            type="button"
            onClick={onOpenConsent}
            className="font-medium text-primary-600 transition-colors hover:text-primary-700 focus-visible:underline focus-visible:outline-none dark:text-primary-400"
          >
            Attiva
          </button>
        )}
      </div>
    );
  }

  if (steered) {
    return (
      <p className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 px-3 py-2.5 text-xs text-emerald-600 dark:border-slate-800 dark:text-emerald-400">
        <Check size={13} className="shrink-0" aria-hidden="true" />
        Terrò conto: privilegerò «{humanizeEdgeType(relationType)}».
      </p>
    );
  }

  // Optimistic + fire-and-forget, same contract as CanonSteer: flip to the
  // confirmation instantly; the POST outcome is not surfaced (a failed teach is
  // not worth a scary error — the next deliberation stands on its own).
  return (
    <div className="shrink-0 border-t border-slate-200 px-3 py-2.5 dark:border-slate-800">
      <button
        type="button"
        onClick={onPrefer}
        title={`Indica al collegio di privilegiare la relazione ${humanizeEdgeType(relationType)} nell'esplorazione del grafo`}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-700 dark:hover:bg-primary-950/40 dark:hover:text-primary-300"
      >
        <Route size={13} className="shrink-0" aria-hidden="true" />
        Privilegia questa relazione
      </button>
    </div>
  );
}

/** A canon weight [0..1] as a rounded percentage; clamped and defensive on NaN. */
function formatCanonPct(weight: number): string {
  const w = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  return `${Math.round(w * 100)}%`;
}

/**
 * A consulted source, provenance-colored, that RE-CENTERS the canvas on click
 * (design §3.2 "sources light up as nodes") rather than navigating away like
 * QaSourceChip's `/grafo?urn=` link. Prefers `node_id` (the real graph node)
 * over the urn so the join lands on the exact provisional/seed node.
 *
 * Wave C (gap C1): a SECOND affordance row — per-source relevance (👍/👎, when
 * `onRate` is wired) and, for provisional sources, "ricorda nel grafo"
 * (`onConfirm`) reflecting `confirmState` ('pending'/'done'/'error') exactly
 * like the old QaSourceChip. Both stop propagation so they never trigger the
 * onCenter re-center click.
 */
function DeliberationSourceChip({
  source,
  onCenter,
  onHover,
  isSelected = false,
  onRate,
  onConfirm,
  confirmState,
  onOpenNorm,
}: {
  source: QaRetrievedSource;
  onCenter: (nodeIdOrUrn: string) => void;
  /** Audit item 3a: non-destructive hover pulse (see DeliberationColumnProps.onSourceHover). */
  onHover?: (nodeIdOrUrn: string | null) => void;
  /** Audit item 3b: this chip's source resolves to the CURRENT canvas selection. */
  isSelected?: boolean;
  onRate?: (relevant: boolean) => void;
  onConfirm?: () => void;
  confirmState?: ConfirmState;
  /**
   * "Apri" (feature 3, quick-open) — the PAGE owns Router/store access (the
   * established pattern in this file: navigation is always a callback prop,
   * e.g. `onRecenter`/`onSourceCenter`), so this stays a presentational leaf.
   * Absent → no "Apri la norma" affordance (the graph re-center via `onCenter`
   * stays the only action, as it was before this feature).
   */
  onOpenNorm?: (params: SearchParams) => void;
}): React.ReactElement {
  const meta = provenanceMeta(source.provenance);
  const displayUrn = source.urn.startsWith('live:') && source.source_url ? source.source_url : source.urn;
  const label = sourceLabel(source);
  const target = source.node_id ?? source.urn;
  const confirmable = source.provenance === 'live_unconfirmed' && Boolean(source.node_id) && Boolean(onConfirm);

  // "Apri" (feature 3, quick-open): the graph re-center (onCenter, the card
  // body click) stays as the SECONDARY action; opening the norma/sentenza
  // directly is the new PRIMARY action in the row below.
  const kind = urnKind(displayUrn);
  const normParams = kind.kind === 'norma' && onOpenNorm ? normRefToSearchParams(displayUrn) : null;
  const openNorma = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (normParams && onOpenNorm) onOpenNorm(normParams);
  };
  const openSentenza = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (source.source_url) window.open(source.source_url, '_blank', 'noopener,noreferrer');
  };
  const showOpen = Boolean(normParams) || (kind.kind === 'sentenza' && Boolean(source.source_url));

  return (
    <li
      data-source-node-id={source.node_id ?? ''}
      data-source-urn={source.urn}
      aria-current={isSelected ? 'true' : undefined}
      onMouseEnter={() => onHover?.(target)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-white transition-shadow dark:bg-slate-900',
        isSelected
          ? 'border-primary-300 ring-2 ring-primary-400 dark:border-primary-700 dark:ring-primary-500'
          : 'border-slate-200 dark:border-slate-700',
      )}
    >
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
      {(onRate || confirmable || showOpen) && (
        <div className="flex flex-wrap items-center gap-1 gap-y-1 border-t border-slate-100 px-3 py-1 dark:border-slate-800">
          {normParams && (
            <button
              type="button"
              onClick={openNorma}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400 dark:hover:bg-primary-950/40"
            >
              <BookOpen size={12} /> Apri la norma
            </button>
          )}
          {kind.kind === 'sentenza' && source.source_url && (
            <button
              type="button"
              onClick={openSentenza}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400 dark:hover:bg-primary-950/40"
            >
              <Scale size={12} /> Apri la sentenza
            </button>
          )}
          {onRate && (
            <>
              <button
                type="button"
                aria-label={`Segna ${label} come pertinente`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRate(true);
                }}
                className="rounded-md p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-emerald-950/40"
              >
                <ThumbsUp size={12} />
              </button>
              <button
                type="button"
                aria-label={`Segna ${label} come non pertinente`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRate(false);
                }}
                className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/40"
              >
                <ThumbsDown size={12} />
              </button>
            </>
          )}
          {confirmable && onConfirm && (
            <button
              type="button"
              disabled={confirmState === 'pending' || confirmState === 'done'}
              onClick={(e) => {
                e.stopPropagation();
                onConfirm();
              }}
              className={cn(
                'ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                confirmState === 'done'
                  ? 'border-emerald-200 text-emerald-600 dark:border-emerald-900'
                  : 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950/40',
              )}
            >
              {confirmState === 'pending' && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
              {confirmState === 'done' && <Check size={12} aria-hidden="true" />}
              {confirmState !== 'pending' && confirmState !== 'done' && <Sprout size={12} aria-hidden="true" />}
              {confirmState === 'done'
                ? 'Ricordata'
                : confirmState === 'pending'
                  ? 'Salvataggio…'
                  : confirmState === 'error'
                    ? 'Riprova'
                    : 'Ricorda nel grafo'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function NodoTab({
  selectedNode,
  selectedEdge,
  nodesById,
  edges,
  canContribute,
  onPreferRelation,
  onOpenConsent,
  steeredKeys,
  onMarkSteered,
  latestTraceId,
  onRecenter,
  onClose,
  onAddToContext,
  contextIds,
}: {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdgeSelection | null;
  nodesById: Map<string, GraphNode>;
  edges: GraphEdge[];
  canContribute: boolean;
  onPreferRelation?: (relationType: string) => void;
  onOpenConsent?: () => void;
  steeredKeys: ReadonlySet<string>;
  onMarkSteered: (key: string) => void;
  latestTraceId: string | null;
  onRecenter?: (node: GraphNode) => void;
  onClose?: () => void;
  onAddToContext?: (node: GraphNode) => void;
  contextIds?: ReadonlySet<string>;
}): React.ReactElement {
  const recenter = onRecenter ?? (() => {});
  const close = onClose ?? (() => {});

  // Edge selection takes precedence (the user just clicked an arc). A REAL
  // relation opens the built EdgeDetailsDrawer; a synthetic CONTRAST arc opens the
  // per-conflict view. The discriminated union makes the two branches exhaustive.
  if (selectedEdge) {
    if (selectedEdge.kind === 'relation') {
      const edge = selectedEdge.edge;
      // Wave 2 P2.7: the steer is idempotent per (deliberation, relation TYPE)
      // — the same trace_id the page binds into onPreferRelation — so
      // re-selecting the same edge (or a sibling of the same type) shows the
      // confirmation instead of re-arming; a NEW deliberation re-arms it.
      const relationSteerKey = `relation|${latestTraceId ?? 'none'}|${edge.type}`;
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <EdgeDetailsDrawer edge={edge} nodesById={nodesById} onRecenter={recenter} onClose={close} />
          </div>
          {/* Slice 4 L3 — the relation steer, rendered ONLY when the page bound a
              deliberation trace (onPreferRelation present). A CONTRAST arc never
              gets one: it is synthetic, not a graph relation to traverse. */}
          {onPreferRelation && (
            <RelationSteer
              relationType={edge.type}
              canContribute={canContribute}
              steered={steeredKeys.has(relationSteerKey)}
              onPrefer={() => {
                onPreferRelation(edge.type);
                onMarkSteered(relationSteerKey);
              }}
              onOpenConsent={onOpenConsent}
            />
          )}
        </div>
      );
    }
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <ContrastConflictView selection={selectedEdge} onClose={close} />
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
          onAddToContext={onAddToContext}
          inContext={contextIds?.has(selectedNode.id) ?? false}
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

/**
 * Per-conflict view for a CONTRAST arc (design §3.4 "dissent is an arc, not a
 * paragraph"). Mirrors the EdgeDetailsDrawer layout: header + the two canons in
 * contrast (canon-colored) + the intensity + the reason (`contention_point`) and,
 * when present, each canon's excerpt at the point of contrast. A devil's-advocate
 * contrast is flagged as a DELIBERATE challenge, not an organic split.
 */
function ContrastConflictView({
  selection,
  onClose,
}: {
  selection: Extract<GraphEdgeSelection, { kind: 'contrast' }>;
  onClose: () => void;
}): React.ReactElement {
  const { conflict, expertALabel, expertBLabel, isDevilsAdvocate, devilsAdvocateExpertLabel } = selection;
  const colorA = (CANON_STYLE as Record<string, { color: string } | undefined>)[conflict.expert_a]?.color ?? '#475569';
  const colorB = (CANON_STYLE as Record<string, { color: string } | undefined>)[conflict.expert_b]?.color ?? '#475569';
  const score = Number.isFinite(conflict.conflict_score)
    ? Math.max(0, Math.min(1, conflict.conflict_score))
    : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
            <Swords size={14} className="shrink-0 text-red-500" aria-hidden="true" />
            Contrasto tra canoni
          </h2>
          {isDevilsAdvocate && (
            <span className="mt-1 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">
              Sfida deliberata{devilsAdvocateExpertLabel ? ` di ${devilsAdvocateExpertLabel}` : ''} (avvocato del diavolo)
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Chiudi"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        {/* The two canons in contrast, canon-colored. */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-200" style={{ backgroundColor: `${colorA}22` }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorA }} />
            {expertALabel}
          </span>
          <span className="text-xs text-slate-400" aria-hidden="true">⚔</span>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-200" style={{ backgroundColor: `${colorB}22` }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorB }} />
            {expertBLabel}
          </span>
        </div>

        {/* Intensity of the contrast (drives the arc thickness on canvas). */}
        <div>
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-400">Intensità del contrasto</p>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <span className="block h-full rounded-full bg-red-400" style={{ width: `${Math.round(score * 100)}%` }} />
            </span>
            <span className="tabular-nums text-slate-400">{score.toFixed(2)}</span>
          </div>
        </div>

        {conflict.contention_point && (
          <div>
            <p className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-400">Punto di divergenza</p>
            <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{conflict.contention_point}</p>
          </div>
        )}

        {conflict.excerpt_a && (
          <div>
            <p className="mb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorA }} aria-hidden="true" />
              {expertALabel}
            </p>
            <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{conflict.excerpt_a}</p>
          </div>
        )}

        {conflict.excerpt_b && (
          <div>
            <p className="mb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorB }} aria-hidden="true" />
              {expertBLabel}
            </p>
            <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{conflict.excerpt_b}</p>
          </div>
        )}
      </div>
    </div>
  );
}
