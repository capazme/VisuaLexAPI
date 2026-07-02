import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { CANON_LABEL } from './format';
import type { QaAnswer } from './types';

/**
 * "Come ci sono arrivato" — transparency of the deliberation (Loop β F.2).
 * Shows the canons the engine consulted (reasoning narrative) and an optional
 * detailed 3-layer assessment. Legal lexicon, no scores/bars/gamification.
 *
 * Sources moved OUT of this panel in Slice 3 (§3.5, "non-negotiable"): the
 * provenance chips are now rendered directly under the answer by QaTurn, always
 * visible; this panel keeps the reasoning narrative only. The detailed
 * assessment is a teaching channel (feedback), so it renders only for
 * full-consent contributors.
 */

type Grade = 0.3 | 0.6 | 0.9;
const GRADES: { value: Grade; label: string }[] = [
  { value: 0.3, label: 'scarso' },
  { value: 0.6, label: 'adeguato' },
  { value: 0.9, label: 'ottimo' },
];
const DIMENSIONS: { key: 'retrieval' | 'reasoning' | 'synthesis'; label: string }[] = [
  { key: 'retrieval', label: 'Fonti recuperate' },
  { key: 'reasoning', label: 'Ragionamento' },
  { key: 'synthesis', label: 'Esposizione' },
];

export interface QaDeliberationPanelProps {
  answer: QaAnswer;
  onDetailed: (scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number }) => void;
  /** Detailed assessment is a teaching channel — gated on full consent. */
  canContribute?: boolean;
}

export function QaDeliberationPanel({ answer, onDetailed, canContribute }: QaDeliberationPanelProps) {
  const [grades, setGrades] = useState<Record<string, Grade>>({});
  const [sent, setSent] = useState(false);

  const allGraded = DIMENSIONS.every((d) => grades[d.key] !== undefined);
  const submitDetailed = (): void => {
    if (!allGraded) return;
    onDetailed({
      retrievalScore: grades.retrieval,
      reasoningScore: grades.reasoning,
      synthesisScore: grades.synthesis,
    });
    setSent(true);
  };

  return (
    <details className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 dark:text-slate-300">
        Come ci sono arrivato
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-3 dark:border-slate-700">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Canoni interpellati</p>
          <div className="flex flex-wrap gap-1.5">
            {answer.experts_used.map((e) => (
              <span key={e} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {CANON_LABEL[e] ?? e}
              </span>
            ))}
          </div>
        </div>

        {canContribute && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Valutazione dettagliata</p>
            {sent ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">Grazie, valutazione registrata.</p>
            ) : (
              <div className="space-y-2">
                {DIMENSIONS.map((d) => (
                  <div key={d.key} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-600 dark:text-slate-300">{d.label}</span>
                    <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
                      {GRADES.map((g) => (
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
                  className="mt-1 text-sm font-medium text-primary-600 disabled:text-slate-300 dark:text-primary-400"
                >
                  Invia valutazione
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
