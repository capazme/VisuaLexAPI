import { useEffect, useState } from 'react';
import { Download, Loader2, Lock, Sprout, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { QaDeliberationPanel } from './QaDeliberationPanel';
import { QaSourceChip } from './QaSourceChip';
import { CANON_LABEL } from './format';
import type { QaRetrievedSource, QaTurnModel } from './types';
import { QaSynthesisWithCitations } from '../ner/QaSynthesisWithCitations';
import { QaProcessTrace } from './QaProcessTrace';
import { downloadAnswerJson } from './answerExport';
import type { NerFeedbackInput } from '../../../services/merltService';

export interface QaTurnProps {
  turn: QaTurnModel;
  onRate: (rating: 1 | 5) => void;
  onRefine: (followUp: string) => void;
  onConfirm: (s: QaRetrievedSource) => void;
  onRateSource: (sourceId: string, relevant: boolean) => void;
  onPrefer: (expert: string) => void;
  onDetailed: (scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number }) => void;
  /** Re-submit this turn's question after a failure (Riprova). */
  onRetry?: () => void;
  /** Abort the in-flight request while loading (Annulla). */
  onCancel?: () => void;
  /** Forward an in-prose citation NER feedback (surface=qa_chip). */
  onNerCitation?: (payload: NerFeedbackInput) => void;
  /**
   * Full consent (D2): unlocks the teaching channels — inline rating, per-source
   * relevance, "mi convince", detailed assessment, "ricorda nel grafo", in-prose
   * NER feedback. Asking/refining stays available at `basic` (that's `qaAskable`).
   */
  canContribute?: boolean;
  /** Open the consent dialog from the inline upsell shown when !canContribute. */
  onOpenConsent?: () => void;
  /** Dev mode: render the pipeline trace under the answer. */
  devMode?: boolean;
}

function confidenceLabel(c: number): string {
  if (c >= 0.75) return 'alta';
  if (c >= 0.5) return 'media';
  return 'bassa';
}

/**
 * Ticks once per second while a turn is loading, so the elapsed indicator stays
 * live during the up-to-120s wait. External-clock subscription: the setState
 * lives only in the interval callback, never synchronously in the effect body
 * (react-hooks/set-state-in-effect). The "reset on a new startedAt" is derived
 * during render via a prev-input tracker (gotcha #11), not via an in-effect
 * setState. Returns whole elapsed seconds, or null when there is no known start
 * time (e.g. a turn restored from storage).
 */
function useElapsedSeconds(startedAt?: number): number | null {
  // Baseline `now` at the wait's start (a pure value in scope) so 0s shows until
  // the first tick; the interval then advances it. Re-baseline on a new startedAt
  // is derived during render (gotcha #11), keeping render pure (react-hooks/purity).
  const [now, setNow] = useState(startedAt ?? 0);
  const [trackedStart, setTrackedStart] = useState(startedAt);
  if (startedAt !== trackedStart) {
    setTrackedStart(startedAt);
    setNow(startedAt ?? 0);
  }
  useEffect(() => {
    if (startedAt === undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (startedAt === undefined) return null;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** Compact inline upsell: asking is unlocked, teaching needs full consent (D2). */
function TeachUpsell({ onOpenConsent }: { onOpenConsent?: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <Lock size={13} className="shrink-0" />
      <span>Per insegnare a MERL-T serve il consenso completo.</span>
      {onOpenConsent && (
        <button
          type="button"
          onClick={onOpenConsent}
          className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 focus-visible:outline-none focus-visible:underline"
        >
          Attiva
        </button>
      )}
    </div>
  );
}

export function QaTurn({
  turn,
  onRate,
  onRefine,
  onConfirm,
  onRateSource,
  onPrefer,
  onDetailed,
  onRetry,
  onCancel,
  onNerCitation,
  canContribute,
  onOpenConsent,
  devMode,
}: QaTurnProps) {
  const [refining, setRefining] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const elapsed = useElapsedSeconds(turn.state.status === 'loading' ? turn.state.startedAt : undefined);

  const submitRefine = (): void => {
    const q = followUp.trim();
    if (!q) return;
    onRefine(q);
    setFollowUp('');
    setRefining(false);
  };

  return (
    <div className="space-y-2">
      {/* Question bubble */}
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary-50 px-3 py-2 text-sm text-primary-900 dark:bg-primary-950/40 dark:text-primary-100">
          {turn.question}
        </p>
      </div>

      {turn.state.status === 'loading' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          <span className="flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} /> MERL-T sta ragionando…
          </span>
          {elapsed !== null && (
            <span className="tabular-nums text-xs text-slate-400" aria-live="polite">
              {elapsed}s
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-medium text-slate-500 underline transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Annulla
            </button>
          )}
        </div>
      )}

      {turn.state.status === 'error' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30"
        >
          <p className="text-sm text-amber-700 dark:text-amber-400">{turn.state.error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-sm font-medium text-amber-800 underline transition-colors hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-300 dark:hover:text-amber-200"
            >
              Riprova
            </button>
          )}
        </div>
      )}

      {turn.state.status === 'success' && (() => {
        const a = turn.state.answer;
        const isDivergent = a.mode === 'divergent' && a.alternatives && a.alternatives.length > 0;
        const hasSources = a.retrieved_sources.length > 0;
        return (
          <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            {isDivergent ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tesi a confronto</p>
                {a.alternatives!.map((alt) => (
                  <div key={alt.expert} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {CANON_LABEL[alt.expert] ?? alt.expert}
                      </span>
                      {canContribute && (
                        <button
                          type="button"
                          onClick={() => onPrefer(alt.expert)}
                          className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:border-primary-300 hover:text-primary-600 dark:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          Mi convince
                        </button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{alt.position}</p>
                    {alt.legal_basis.length > 0 && (
                      <p className="mt-1 text-xs text-slate-400">{alt.legal_basis.join(' · ')}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <QaSynthesisWithCitations text={a.synthesis} enabled={canContribute} onSubmit={onNerCitation} />
            )}

            {/* Confidence */}
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
              {/* Diagnostic export: the WHOLE answer incl. pipeline_trace
                  (tool_calls, react_steps, errors) as a shareable .json. */}
              <button
                type="button"
                onClick={() => downloadAnswerJson(a, turn.question)}
                title="Esporta la risposta completa in JSON (trace, strumenti, errori) per la diagnostica"
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <Download size={13} className="shrink-0" aria-hidden="true" />
                Esporta JSON
              </button>
            </div>

            {/* Sources always visible (§3.5, "non-negotiable"): rendered directly
                under the answer, OUTSIDE the collapsed deliberation panel. A turn
                with 0 sources (e.g. reloaded from history) shows no sources block
                and no source-rating control — an empty "FONTI CONSULTATE (0)" +
                rating request undermines trust. */}
            {hasSources && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Fonti consultate ({a.retrieved_sources.length})
                </p>
                <ul className="space-y-1.5">
                  {a.retrieved_sources.map((s) => (
                    <QaSourceChip
                      key={s.node_id ?? s.urn}
                      source={s}
                      cited={a.sources.find((c) => c.article_urn === s.urn)}
                      confirmState={s.node_id ? turn.confirmed[s.node_id] : undefined}
                      onConfirm={canContribute ? onConfirm : undefined}
                      onRate={canContribute ? onRateSource : undefined}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Slice C wave 3 (transparency): the graph co-evolves from this
                answer's live retrievals. Informational nudge — the EXPLICIT
                per-source confirm is the "ricorda nel grafo" action on the
                provisional QaSourceChips above (fresh nodes aren't in the
                /merlt/valida review queue yet — that only holds quarantined
                doubtful nodes). */}
            {(a.provisional_candidates ?? 0) > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                <Sprout size={14} className="mt-0.5 shrink-0" />
                <span>
                  Il grafo sta assorbendo {a.provisional_candidates}{' '}
                  {a.provisional_candidates === 1 ? 'norma recuperata' : 'norme recuperate'} dal vivo da
                  questa risposta. Conferma quelle utili con «ricorda nel grafo» sulle fonti qui sopra.
                </span>
              </div>
            )}

            <QaDeliberationPanel answer={a} onDetailed={onDetailed} canContribute={canContribute} />

            {devMode && <QaProcessTrace answer={a} />}

            {/* Inline feedback + refine. Rating is a teaching channel (full
                consent); refine is asking, available at basic. */}
            {canContribute ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  aria-label="Risposta utile"
                  aria-pressed={turn.rating === 5}
                  onClick={() => onRate(5)}
                  className={cn(
                    'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                    turn.rating === 5 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40' : 'text-slate-400 hover:text-emerald-600',
                  )}
                >
                  <ThumbsUp size={15} />
                </button>
                <button
                  type="button"
                  aria-label="Risposta non utile"
                  aria-pressed={turn.rating === 1}
                  onClick={() => onRate(1)}
                  className={cn(
                    'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500',
                    turn.rating === 1 ? 'bg-red-50 text-red-600 dark:bg-red-950/40' : 'text-slate-400 hover:text-red-600',
                  )}
                >
                  <ThumbsDown size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setRefining((v) => !v)}
                  className="ml-auto text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 focus-visible:outline-none focus-visible:underline"
                >
                  Approfondisci
                </button>
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-center border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setRefining((v) => !v)}
                    className="ml-auto text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 focus-visible:outline-none focus-visible:underline"
                  >
                    Approfondisci
                  </button>
                </div>
                <TeachUpsell onOpenConsent={onOpenConsent} />
              </>
            )}

            {refining && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitRefine();
                    }
                  }}
                  placeholder="Domanda di approfondimento…"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={submitRefine}
                  disabled={!followUp.trim()}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-300 dark:disabled:bg-slate-700"
                >
                  Invia
                </button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
