import { useMemo, useState, type ReactNode } from 'react';
import { extractCitations, formatCitationLabel, type CitationMatch, type ParsedCitationData } from '../../../utils/citationMatcher';
import type { NerFeedbackInput, NerFeedbackType, NerCorrectReference } from '../../../services/merltService';
import { CitationNerFeedback } from './CitationNerFeedback';
import { cn } from '../../../lib/utils';
import { parseQaMarkdown, type InlineSpan } from './qaMarkdown';

const CONTEXT_RADIUS = 500;

export interface QaSynthesisWithCitationsProps {
  text: string;
  /** Enable interactive in-prose NER feedback (full-consent contributor). */
  enabled?: boolean;
  /** Build + forward one NER feedback payload (surface=qa_chip). */
  onSubmit?: (payload: NerFeedbackInput) => void;
}

const TEXT_CLS = 'text-sm leading-relaxed text-slate-800 dark:text-slate-200';

/**
 * Renders the Q&A synthesis with a minimal markdown renderer (bold/italic,
 * headings, lists, paragraphs — LLM answers ship `**`/`#` markers that must
 * not appear literally), turning each detected legal citation into an
 * interactive marker. Clicking one opens an inline NER feedback affordance
 * (✓/✗/Correggi) whose context window is ±500 chars around the citation
 * WITHIN THE ANSWER — never the user's raw query (privacy, decision 4).
 * Citations and their context are extracted from the marker-stripped plain
 * text, so offsets stay stable and the NER trainer never sees `**` noise.
 * Loop β #2, surface qa_chip.
 */
export function QaSynthesisWithCitations({ text, enabled, onSubmit }: QaSynthesisWithCitationsProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const parsed = useMemo(() => parseQaMarkdown(text), [text]);

  const matches = useMemo(() => {
    if (!enabled) return [];
    const sorted = [...extractCitations(parsed.plainText)].sort((a, b) => a.startIndex - b.startIndex);
    // Drop overlapping matches (keep the earliest), mirroring the previous
    // cursor-based skip.
    const out: CitationMatch[] = [];
    let cursor = 0;
    for (const m of sorted) {
      if (m.startIndex < cursor) continue;
      out.push(m);
      cursor = m.endIndex;
    }
    return out;
  }, [parsed, enabled]);

  const active = activeIdx !== null ? (matches[activeIdx] ?? null) : null;

  const handleSubmit =
    (citation: ParsedCitationData, startIndex: number, endIndex: number, selectedText: string) =>
    (feedbackType: NerFeedbackType, correctReference?: NerCorrectReference) => {
      const contextWindow = parsed.plainText.slice(
        Math.max(0, startIndex - CONTEXT_RADIUS),
        Math.min(parsed.plainText.length, endIndex + CONTEXT_RADIUS),
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

  // ── Inline rendering: walk each block's spans against the citation ranges
  // (plain-text offsets). A citation straddling a style boundary renders as a
  // single chip (its own styling wins); each chip is emitted exactly once.
  const emittedChips = new Set<number>();

  const makeChip = (m: CitationMatch, i: number): ReactNode => (
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
      {parsed.plainText.slice(m.startIndex, m.endIndex)}
    </button>
  );

  const styledText = (span: InlineSpan, textPart: string, key: string): ReactNode => {
    if (!textPart) return null;
    if (span.bold && span.italic)
      return (
        <strong key={key}>
          <em>{textPart}</em>
        </strong>
      );
    if (span.bold) return <strong key={key}>{textPart}</strong>;
    if (span.italic) return <em key={key}>{textPart}</em>;
    return textPart;
  };

  const renderSpans = (spans: InlineSpan[], keyPrefix: string): ReactNode[] => {
    const out: ReactNode[] = [];
    spans.forEach((span, si) => {
      const spanEnd = span.plainStart + span.text.length;
      let pos = span.plainStart;
      let frag = 0;
      while (pos < spanEnd) {
        const mIdx = matches.findIndex((m) => m.endIndex > pos && m.startIndex < spanEnd);
        if (mIdx === -1) {
          out.push(styledText(span, span.text.slice(pos - span.plainStart), `${keyPrefix}-${si}-${frag++}`));
          break;
        }
        const m = matches[mIdx];
        if (m.startIndex > pos) {
          out.push(
            styledText(
              span,
              span.text.slice(pos - span.plainStart, m.startIndex - span.plainStart),
              `${keyPrefix}-${si}-${frag++}`,
            ),
          );
        }
        if (!emittedChips.has(mIdx)) {
          emittedChips.add(mIdx);
          out.push(makeChip(m, mIdx));
        }
        pos = Math.min(spanEnd, m.endIndex);
      }
    });
    return out;
  };

  return (
    <div>
      {parsed.blocks.map((block, bi) => {
        if (block.kind === 'heading') {
          const Tag = block.level <= 2 ? 'h3' : block.level === 3 ? 'h4' : 'h5';
          return (
            <Tag
              key={bi}
              className={cn(
                'mb-1 mt-3 font-semibold text-slate-900 first:mt-0 dark:text-slate-100',
                block.level <= 2 ? 'text-base' : 'text-sm',
              )}
            >
              {renderSpans(block.spans, `h${bi}`)}
            </Tag>
          );
        }
        if (block.kind === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={bi}
              className={cn('my-2 space-y-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc', TEXT_CLS)}
            >
              {block.items.map((item, ii) => (
                <li key={ii}>{renderSpans(item, `l${bi}-${ii}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={bi} className={cn('my-2 whitespace-pre-wrap first:mt-0 last:mb-0', TEXT_CLS)}>
            {renderSpans(block.spans, `p${bi}`)}
          </p>
        );
      })}
      {active && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            Riferimento: {formatCitationLabel(active.parsed)}
          </p>
          <CitationNerFeedback
            key={`qa-ner-${activeIdx}`}
            citation={active.parsed}
            onSubmit={handleSubmit(
              active.parsed,
              active.startIndex,
              active.endIndex,
              parsed.plainText.slice(active.startIndex, active.endIndex),
            )}
          />
        </div>
      )}
    </div>
  );
}
