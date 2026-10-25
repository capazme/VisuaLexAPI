import { CircleCheck, CircleDashed, Flag } from 'lucide-react';
import { aiReviewSignal, aiReviewSummary, type AiReviewCounts } from '../../utils/aiReview';
import { cn } from '../../lib/utils';

/**
 * The traffic light of a dossier row (D7b): what the user still has to do with what an application wrote on that
 * entry. Red with a flag when one item is «Da rivedere», else yellow with a dashed ring when one is «da validare»,
 * else green with a tick; nothing when the application wrote nothing. A shape for each state, never colour alone, and
 * the counts in words on hover and for a screen reader («2 da validare · 1 da rivedere»).
 */
export function AiReviewSignal({ counts, className }: { counts: AiReviewCounts; className?: string }) {
  const signal = aiReviewSignal(counts);
  if (!signal) return null;
  const summary = aiReviewSummary(counts);
  const Icon = signal === 'review' ? Flag : signal === 'pending' ? CircleDashed : CircleCheck;
  return (
    <span
      data-ai-review={signal}
      title={summary}
      className={cn(
        'inline-flex shrink-0 items-center',
        className,
        signal === 'review' && 'text-red-600 dark:text-red-400',
        signal === 'pending' && 'text-amber-600 dark:text-amber-400',
        signal === 'validated' && 'text-emerald-600 dark:text-emerald-400',
      )}
    >
      <Icon size={14} strokeWidth={2.5} aria-hidden className={cn(signal === 'review' && 'fill-current')} />
      <span className="sr-only">{summary}</span>
    </span>
  );
}
