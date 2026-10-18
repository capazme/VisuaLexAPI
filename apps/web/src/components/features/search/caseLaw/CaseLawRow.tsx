import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../../constants/interactions';
import { formatDateItalianLong } from '../../../../utils/dateUtils';
import { DECISION_PAGE_AVAILABLE, formatDecisionShort, linkableDecisionPath, type LooseDecisionRef } from '../../../../utils/decisionLinks';
import type { ReadingBackEntry } from '../../../../utils/readingBackStack';
import { DecisionLink } from '../../decisions/DecisionLink';
import { authorityColor } from './authorityColor';

/** Where the browser cannot measure (nothing is laid out yet), a text longer than this is cut. */
const UNMEASURED_LONG_TEXT = 240;

interface CaseLawRowProps {
  /** The decision the row is about: its estremi are a link that opens beside the article. */
  decision?: LooseDecisionRef | null;
  /** The estremi as a source writes them; the decision's short label when there is a decision. */
  label?: string;
  /** Added after the estremi: «n. 10/2020» of an authority we do not link. */
  detail?: string;
  /** Names the court for the chip's colour («Cass. civ.»); defaults to the label. */
  authority?: string | null;
  /** The exact deposit or decision day (`YYYY-MM-DD`) when known... */
  date?: string | null;
  /** ...else the year. */
  year?: number | null;
  /** The date as the caller words it («Ordinanza depositata il 1 settembre 2026»); replaces `date` and `year` in the text. */
  whenLabel?: string | null;
  /** The source, as a small label. */
  source?: string;
  badges?: string[];
  /** A line under the estremi: where the text comes from (a review's provenance). */
  context?: ReactNode;
  /** A page outside VisuaLex the estremi open (a new tab), when no reader of ours holds the decision. */
  externalHref?: string;
  /** Said beside an external link, so the reader knows where it goes («su EUR-Lex»). */
  externalNote?: string;
  /** Where the decision opens beside (a practice or one of its windows) and the way back. */
  besideId?: string;
  backEntry?: ReadingBackEntry;
  /** The short text (a massima, a passage, a fragment), cut at three lines with «Mostra tutto». */
  children?: ReactNode;
  /** Under the text: the decisions a passage cites, the source's credit. */
  footer?: ReactNode;
}

/** Whether a text cut at three lines is longer than they hold. */
function overflowsCut(el: HTMLElement): boolean {
  // nothing laid out (hidden, or no layout engine): a long text is taken to overflow
  if (el.clientHeight === 0) return (el.textContent ?? '').length > UNMEASURED_LONG_TEXT;
  return el.scrollHeight > el.clientHeight + 1;
}

function ClampedText({ children }: { children: ReactNode }) {
  const textId = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured while cut and again when the width changes; once opened the answer is kept, so «Mostra meno» stays.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setOverflows(overflowsCut(el));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setOverflows(overflowsCut(el)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, children]);

  return (
    <>
      <p ref={ref} id={textId} className={cn('text-sm leading-relaxed text-slate-700 dark:text-slate-300', !expanded && 'line-clamp-3')}>
        {children}
      </p>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400',
            TOUCH_TARGET_RESPONSIVE,
          )}
        >
          {expanded ? 'Mostra meno' : 'Mostra tutto'}
        </button>
      )}
    </>
  );
}

/**
 * The one row of case law under an article (case-law section spec, D3), whatever the source: the
 * decision's estremi as a link that opens beside, the day when known else the year, a short text,
 * the source as a small label. Brocardi's massime, the Massimario's passages and the Cassazione's
 * hits all draw it, so the three read alike. Draws an `<li>`: the caller owns the `<ul>`.
 */
export function CaseLawRow({
  decision, label, detail, authority, date, year, whenLabel, source, badges, context, externalHref, externalNote, besideId, backEntry, children, footer,
}: CaseLawRowProps) {
  const estremi = label ?? (decision ? formatDecisionShort(decision) : undefined);
  const chip = cn('rounded px-2 py-0.5 text-xs font-medium', authorityColor(authority ?? estremi));
  const linked = decision && DECISION_PAGE_AVAILABLE && linkableDecisionPath(decision) !== null ? decision : null;
  const when = whenLabel ?? (date ? formatDateItalianLong(date) : year ? String(year) : null);

  return (
    <li className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {estremi && (linked ? (
          <DecisionLink
            to={linked}
            besideId={besideId}
            backEntry={backEntry}
            className={cn(chip, 'inline-flex items-center hover:underline', TOUCH_TARGET_RESPONSIVE)}
          >
            {estremi}
          </DecisionLink>
        ) : externalHref ? (
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(chip, 'inline-flex items-center gap-1 hover:underline', TOUCH_TARGET_RESPONSIVE)}
          >
            {estremi}
            {externalNote && <span className="font-normal">· {externalNote}</span>}
          </a>
        ) : (
          <span className={chip}>{estremi}</span>
        ))}
        {detail && <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail}</span>}
        {when && (
          <time dateTime={date ?? undefined} className="text-sm text-slate-500 dark:text-slate-400">{when}</time>
        )}
        {badges?.map((badge) => (
          <span key={badge} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {badge}
          </span>
        ))}
        {source && <span className="text-[11px] uppercase text-slate-400 dark:text-slate-500">{source}</span>}
      </div>
      {context}
      {children !== undefined && children !== null && <ClampedText>{children}</ClampedText>}
      {footer}
    </li>
  );
}
