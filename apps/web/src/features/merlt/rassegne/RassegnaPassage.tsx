// apps/web/src/features/merlt/rassegne/RassegnaPassage.tsx
import type { ReactNode } from 'react';
import { DecisionChip } from './DecisionChip';
import { CaseLawRow } from '../../../components/features/search/caseLaw/CaseLawRow';
import { provenance } from './rassegnaFilters';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import type { RassegnaEvidenziazione, RassegnePasso } from './types';

const COMMA_PARTS: Record<string, string> = { com: 'comma', num: 'n.', let: 'lett.' };

function commaLabel(comma: string | null): string | undefined {
  if (!comma) return undefined;
  return comma
    .split('-')
    .map((part) => {
      const match = /^([a-z]+)(.*)$/.exec(part);
      return match ? `${COMMA_PARTS[match[1]] ?? match[1]} ${match[2]}` : part;
    })
    .join(', ');
}

/** The paragraph as text nodes, the citations of this article in <mark>: never HTML. */
function withHighlights(text: string, spans: RassegnaEvidenziazione[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  [...spans].sort((a, b) => a.start - b.start).forEach((span, i) => {
    if (span.start < at || span.end > text.length || span.end <= span.start) return;
    if (span.start > at) out.push(text.slice(at, span.start));
    out.push(
      <mark key={i} title={commaLabel(span.comma)} className="rounded bg-amber-100 px-0.5 text-inherit dark:bg-amber-900/40">
        {text.slice(span.start, span.end)}
      </mark>,
    );
    at = span.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function RassegnaPassage({ passo, besideId, backEntry }: { passo: RassegnePasso; besideId?: string; backEntry?: ReadingBackEntry }) {
  return (
    <CaseLawRow
      source="Massimario"
      context={(
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">{provenance(passo)}</p>
          {passo.autori.length > 0 && <p className="text-xs italic text-slate-500 dark:text-slate-400">di {passo.autori.join(', ')}</p>}
        </>
      )}
      footer={(
        <>
          {passo.pronunce.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {passo.pronunce.map((p, i) => <DecisionChip key={`${p.key ?? p.label}-${i}`} pronuncia={p} besideId={besideId} backEntry={backEntry} />)}
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            Fonte: Ufficio del Massimario della Corte di cassazione ·{' '}
            <a href={passo.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600 dark:hover:text-slate-200">
              Apri sul portale del Massimario
            </a>
          </p>
        </>
      )}
    >
      {withHighlights(passo.testo, passo.evidenziazioni)}
    </CaseLawRow>
  );
}
