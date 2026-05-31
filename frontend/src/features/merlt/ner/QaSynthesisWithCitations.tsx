import { useMemo, useState, type ReactNode } from 'react';
import { extractCitations, formatCitationLabel, type ParsedCitationData } from '../../../utils/citationMatcher';
import type { NerFeedbackInput, NerFeedbackType, NerCorrectReference } from '../../../services/merltService';
import { CitationNerFeedback } from './CitationNerFeedback';
import { cn } from '../../../lib/utils';

const CONTEXT_RADIUS = 500;

export interface QaSynthesisWithCitationsProps {
  text: string;
  /** Enable interactive in-prose NER feedback (full-consent contributor). */
  enabled?: boolean;
  /** Build + forward one NER feedback payload (surface=qa_chip). */
  onSubmit?: (payload: NerFeedbackInput) => void;
}

/**
 * Renders the Q&A synthesis as plain text, turning each detected legal citation
 * into an interactive marker. Clicking one opens an inline NER feedback
 * affordance (✓/✗/Correggi) whose context window is ±500 chars around the
 * citation WITHIN THE ANSWER — never the user's raw query (privacy, decision 4).
 * Loop β #2, surface qa_chip.
 */
export function QaSynthesisWithCitations({ text, enabled, onSubmit }: QaSynthesisWithCitationsProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const matches = useMemo(() => {
    if (!enabled) return [];
    return [...extractCitations(text)].sort((a, b) => a.startIndex - b.startIndex);
  }, [text, enabled]);

  if (matches.length === 0) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">{text}</p>
    );
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.startIndex < cursor) return; // skip overlapping match
    if (m.startIndex > cursor) nodes.push(text.slice(cursor, m.startIndex));
    nodes.push(
      <button
        key={`cit-${i}`}
        type="button"
        aria-label={`Citazione: ${formatCitationLabel(m.parsed)}, dai un riscontro`}
        aria-expanded={activeIdx === i}
        onClick={() => setActiveIdx((prev) => (prev === i ? null : i))}
        className={cn(
          'rounded-sm border-b border-dotted border-blue-400 text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/40',
          activeIdx === i && 'bg-blue-100 dark:bg-blue-900/50',
        )}
      >
        {m.text}
      </button>,
    );
    cursor = m.endIndex;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  const active = activeIdx !== null ? matches[activeIdx] : null;

  const handleSubmit =
    (citation: ParsedCitationData, startIndex: number, endIndex: number, selectedText: string) =>
    (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => {
      const contextWindow = text.slice(
        Math.max(0, startIndex - CONTEXT_RADIUS),
        Math.min(text.length, endIndex + CONTEXT_RADIUS),
      );
      onSubmit?.({
        surface: 'qa_chip',
        feedbackType,
        selectedText,
        contextWindow,
        originalParsed: {
          act_type: citation.act_type,
          act_number: citation.act_number ?? null,
          date: citation.date ?? null,
          article: citation.article,
          confidence: citation.confidence,
        },
        correctReference,
        confidenceBefore: citation.confidence,
      });
    };

  return (
    <div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">{nodes}</p>
      {active && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            Riferimento: {formatCitationLabel(active.parsed)}
          </p>
          <CitationNerFeedback
            key={`qa-ner-${activeIdx}`}
            citation={active.parsed}
            onSubmit={handleSubmit(active.parsed, active.startIndex, active.endIndex, active.text)}
          />
        </div>
      )}
    </div>
  );
}
