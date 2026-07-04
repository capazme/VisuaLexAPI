import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, History, Info, Loader2, Lock, MessageSquare, Network, Route, Scale, Swords, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { AskGraphField } from './AskGraphField';
import { NodeDetailsDrawer } from './NodeDetailsDrawer';
import { EdgeDetailsDrawer } from './EdgeDetailsDrawer';
import { QaHistoryPanel } from '../../qa/QaHistoryPanel';
import { QaSynthesisWithCitations } from '../../ner/QaSynthesisWithCitations';
import { CANON_LABEL, formatRetrievedUrn, provenanceMeta } from '../../qa/format';
import type { QaHistoryItem, QaMode, QaRetrievedSource, QaTurnModel } from '../../qa/types';
import { CANON_STYLE } from '../shared/graphDeliberation';
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
}

function confidenceLabel(c: number): string {
  if (c >= 0.75) return 'alta';
  if (c >= 0.5) return 'media';
  return 'bassa';
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
  onRetry,
  onCancel,
  onSourceCenter,
  onLoadHistoryTurn,
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
          badge={dibattitoBadge}
        />
        <TabButton
          active={activeTab === 'nodo'}
          onClick={() => onTabChange('nodo')}
          icon={<Network size={15} />}
          label="Nodo"
        />
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
          onRetry={onRetry}
          onCancel={onCancel}
          onSourceCenter={onSourceCenter}
          onLoadHistoryTurn={onLoadHistoryTurn}
          expertContributions={expertContributions}
          canContribute={canContribute}
          onPreferCanon={onPreferCanon}
          onOpenConsent={onOpenConsent}
          qaAskable={qaAskable}
          askBusy={askBusy}
          scopeChip={scopeChip}
          canonFocus={canonFocus}
          centerLabel={selectedNode?.label}
          centerUrn={selectedNode?.urn ?? undefined}
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
          onRecenter={onRecenter}
          onClose={onCloseNode}
        />
      </div>
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
  onRetry,
  onCancel,
  onSourceCenter,
  onLoadHistoryTurn,
  expertContributions,
  canContribute,
  onPreferCanon,
  onOpenConsent,
  qaAskable,
  askBusy = false,
  scopeChip,
  canonFocus,
  centerLabel,
  centerUrn,
}: {
  turns: QaTurnModel[];
  onAsk: (question: string, mode: QaMode) => void;
  onRetry: (turnId: string) => void;
  onCancel: (turnId: string) => void;
  onSourceCenter: (nodeIdOrUrn: string) => void;
  onLoadHistoryTurn?: (item: QaHistoryItem) => void;
  expertContributions?: ExpertContribution[];
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
  qaAskable: boolean;
  askBusy?: boolean;
  scopeChip?: { label: string; onReturn: () => void } | null;
  canonFocus?: { key: string; nonce: number } | null;
  centerLabel?: string;
  centerUrn?: string;
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
          turns.map((turn) => (
            <DeliberationTurn
              key={turn.id}
              turn={turn}
              onRetry={() => onRetry(turn.id)}
              onCancel={() => onCancel(turn.id)}
              onSourceCenter={onSourceCenter}
              canContribute={canContribute}
              onPreferCanon={onPreferCanon}
              onOpenConsent={onOpenConsent}
              // The `expertContributions` prop is the CURRENT deliberation's set
              // — only the latest turn falls back to it when its own answer lacks
              // per-canon contributions (a history-loaded turn keeps its own/none).
              fallbackContributions={turn.id === lastTurnId ? expertContributions : undefined}
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
 * onCancel/onRetry. The teaching feedback channels (rating/prefer/detailed/confirm)
 * are P2b (design §5 L2), not shown here.
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
  canContribute,
  onPreferCanon,
  onOpenConsent,
  fallbackContributions,
}: {
  turn: QaTurnModel;
  onRetry: () => void;
  onCancel: () => void;
  onSourceCenter: (nodeIdOrUrn: string) => void;
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
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

              {hasContributions ? (
                <CanonTheses
                  contributions={contributions}
                  traceId={a.trace_id}
                  canContribute={canContribute}
                  onPreferCanon={onPreferCanon}
                  onOpenConsent={onOpenConsent}
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
}: {
  contributions: ExpertContribution[];
  /** The turn's `trace_id`, threaded to each steer so the gradient targets THIS deliberation. */
  traceId: string;
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
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
}: {
  contribution: ExpertContribution;
  traceId: string;
  canContribute: boolean;
  onPreferCanon?: (traceId: string, expert: string) => void;
  onOpenConsent?: () => void;
}): React.ReactElement {
  const { expert, thesis, confidence, weight } = contribution;
  const label = CANON_LABEL[expert] ?? expert;
  const color = (CANON_STYLE as Record<string, { color: string } | undefined>)[expert]?.color ?? '#475569';
  const errored = isErroredThesis(thesis);

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
            onPrefer={() => onPreferCanon(traceId, expert)}
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
 * Consent gate (D2 / §5): with `full` consent the steer button is live; otherwise
 * a compact upsell replaces it (opening the consent dialog) — never a dead button.
 */
function CanonSteer({
  label,
  canContribute,
  onPrefer,
  onOpenConsent,
}: {
  label: string;
  canContribute: boolean;
  onPrefer: () => void;
  onOpenConsent?: () => void;
}): React.ReactElement {
  const [steered, setSteered] = useState(false);

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
  // stands on its own). Re-steering is allowed (click again) but idempotent-looking.
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onPrefer();
    setSteered(true);
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
 */
function RelationSteer({
  relationType,
  canContribute,
  onPrefer,
  onOpenConsent,
}: {
  relationType: string;
  canContribute: boolean;
  onPrefer: () => void;
  onOpenConsent?: () => void;
}): React.ReactElement {
  const [steered, setSteered] = useState(false);

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
        Terrò conto: privilegerò «{relationType}».
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
        onClick={() => {
          onPrefer();
          setSteered(true);
        }}
        title={`Indica al collegio di privilegiare la relazione ${relationType} nell'esplorazione del grafo`}
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
  canContribute,
  onPreferRelation,
  onOpenConsent,
  onRecenter,
  onClose,
}: {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdgeSelection | null;
  nodesById: Map<string, GraphNode>;
  edges: GraphEdge[];
  canContribute: boolean;
  onPreferRelation?: (relationType: string) => void;
  onOpenConsent?: () => void;
  onRecenter?: (node: GraphNode) => void;
  onClose?: () => void;
}): React.ReactElement {
  const recenter = onRecenter ?? (() => {});
  const close = onClose ?? (() => {});

  // Edge selection takes precedence (the user just clicked an arc). A REAL
  // relation opens the built EdgeDetailsDrawer; a synthetic CONTRAST arc opens the
  // per-conflict view. The discriminated union makes the two branches exhaustive.
  if (selectedEdge) {
    if (selectedEdge.kind === 'relation') {
      const edge = selectedEdge.edge;
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <EdgeDetailsDrawer edge={edge} nodesById={nodesById} onRecenter={recenter} onClose={close} />
          </div>
          {/* Slice 4 L3 — the relation steer, rendered ONLY when the page bound a
              deliberation trace (onPreferRelation present). A CONTRAST arc never
              gets one: it is synthetic, not a graph relation to traverse. Keyed
              per edge so a new selection re-arms the optimistic state. */}
          {onPreferRelation && (
            <RelationSteer
              key={edge.id ?? `${edge.source}-${edge.type}-${edge.target}`}
              relationType={edge.type}
              canContribute={canContribute}
              onPrefer={() => onPreferRelation(edge.type)}
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
  const { conflict, expertALabel, expertBLabel, isDevilsAdvocate } = selection;
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
              Sfida deliberata (avvocato del diavolo)
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
