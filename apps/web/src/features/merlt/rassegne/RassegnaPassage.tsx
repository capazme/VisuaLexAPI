// apps/web/src/features/merlt/rassegne/RassegnaPassage.tsx
import { useState, type ReactNode } from 'react';
import { DecisionChip } from './DecisionChip';
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

function provenance(p: RassegnePasso): string {
  const head = p.archivio === 'civile' || p.archivio === 'penale' ? `Rassegna ${p.archivio} ${p.anno}` : `Rassegna ${p.anno}`;
  return [
    head + (p.volume.numero ? ` · vol. ${p.volume.numero}` : ''),
    p.capitolo?.nome,
    `§ ${p.sezione.numero} ${p.sezione.titolo}`.trim(),
  ].filter(Boolean).join(' › ');
}

export function RassegnaPassage({ passo }: { passo: RassegnePasso }) {
  const [full, setFull] = useState(false);
  const long = passo.testo.length > 400;
  return (
    <li className="space-y-2 py-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">{provenance(passo)}</p>
      {passo.autori.length > 0 && <p className="text-xs italic text-slate-500 dark:text-slate-400">di {passo.autori.join(', ')}</p>}
      <p className={`text-sm leading-relaxed text-slate-700 dark:text-slate-300 ${long && !full ? 'line-clamp-4' : ''}`}>
        {withHighlights(passo.testo, passo.evidenziazioni)}
      </p>
      {long && (
        <button type="button" onClick={() => setFull((v) => !v)}
          className="min-h-[44px] text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-primary-400">
          {full ? 'mostra meno' : 'mostra tutto'}
        </button>
      )}
      {passo.pronunce.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {passo.pronunce.map((p, i) => <DecisionChip key={`${p.key ?? p.label}-${i}`} pronuncia={p} />)}
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Fonte: Ufficio del Massimario della Corte di cassazione ·{' '}
        <a href={passo.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600 dark:hover:text-slate-200">
          Apri sul portale del Massimario
        </a>
      </p>
    </li>
  );
}
