import { useState } from 'react';
import { Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { QaDeliberationPanel } from './QaDeliberationPanel';
import { CANON_LABEL } from './format';
import type { QaRetrievedSource, QaTurnModel } from './types';
import { QaSynthesisWithCitations } from '../ner/QaSynthesisWithCitations';
import { QaProcessTrace } from './QaProcessTrace';
import type { NerFeedbackInput } from '../../../services/merltService';

export interface QaTurnProps {
  turn: QaTurnModel;
  onRate: (rating: 1 | 5) => void;
  onRefine: (followUp: string) => void;
  onConfirm: (s: QaRetrievedSource) => void;
  onRateSource: (sourceId: string, relevant: boolean) => void;
  onPrefer: (expert: string) => void;
  onDetailed: (scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number }) => void;
  /** Forward an in-prose citation NER feedback (surface=qa_chip). */
  onNerCitation?: (payload: NerFeedbackInput) => void;
  /** Dev mode: render the pipeline trace under the answer. */
  devMode?: boolean;
}

function confidenceLabel(c: number): string {
  if (c >= 0.75) return 'alta';
  if (c >= 0.5) return 'media';
  return 'bassa';
}

export function QaTurn({ turn, onRate, onRefine, onConfirm, onRateSource, onPrefer, onDetailed, onNerCitation, devMode }: QaTurnProps) {
  const [refining, setRefining] = useState(false);
  const [followUp, setFollowUp] = useState('');

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
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> MERL-T sta ragionando…
        </p>
      )}

      {turn.state.status === 'error' && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          Non è stato possibile ottenere una risposta ({turn.state.error}). Riprova.
        </p>
      )}

      {turn.state.status === 'success' && (() => {
        const a = turn.state.answer;
        const isDivergent = a.mode === 'divergent' && a.alternatives && a.alternatives.length > 0;
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
                      <button
                        type="button"
                        onClick={() => onPrefer(alt.expert)}
                        className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:border-primary-300 hover:text-primary-600 dark:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        Mi convince
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{alt.position}</p>
                    {alt.legal_basis.length > 0 && (
                      <p className="mt-1 text-xs text-slate-400">{alt.legal_basis.join(' · ')}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <QaSynthesisWithCitations text={a.synthesis} enabled onSubmit={onNerCitation} />
            )}

            {/* Confidence */}
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>confidenza {confidenceLabel(a.confidence)}</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    a.confidence >= 0.75 ? 'bg-emerald-400' : a.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400',
                  )}
                  style={{ width: `${Math.round(a.confidence * 100)}%` }}
                />
              </span>
              <span className="text-slate-400">{a.confidence.toFixed(2)}</span>
            </div>

            <QaDeliberationPanel
              answer={a}
              confirmed={turn.confirmed}
              onConfirm={onConfirm}
              onRateSource={onRateSource}
              onDetailed={onDetailed}
            />

            {devMode && <QaProcessTrace answer={a} />}

            {/* Inline feedback + refine */}
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
