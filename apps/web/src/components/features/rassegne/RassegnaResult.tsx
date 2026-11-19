import { forwardRef, useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import { Button } from '../../ui/Button';
import type { SearchParams } from '../../../types';
import { articleLink } from './articleLink';
import { AddPassageToPratica } from './AddPassageToPratica';
import { provenance } from './rassegnaFilters';
import { anchorWord, excerptStart, findWords, type Span } from './searchExcerpt';
import type { RassegnaRisultato } from './types';

/** A passage longer than this (from where the excerpt starts) may be cut at its four lines. */
const LONG = 320;

/** `text` from `from`, the words found in <mark>: text nodes only, never HTML. */
function marked(text: string, spans: Span[], from: number): ReactNode[] {
  const out: ReactNode[] = [];
  let at = from;
  spans.forEach((span, i) => {
    if (span.end <= at) return;
    const start = Math.max(span.start, at);
    if (start > at) out.push(text.slice(at, start));
    out.push(
      <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit dark:bg-amber-900/40">
        {text.slice(start, span.end)}
      </mark>,
    );
    at = span.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

interface Props {
  passo: RassegnaRisultato;
  /** the words searched, as sent (`searchWords`) */
  q: string;
  onOpenArticle: (params: SearchParams) => void;
  /** shown whole from the start (the passage chosen in ⌘K) */
  opened?: boolean;
}

/**
 * One passage found by the page «Rassegne» (spec 2026-11-01-rassegne-search-page §3): where it sits,
 * the lines around the first word found with the words marked, the whole passage on request, the
 * articles it cites as links that open them, the source's credit. Draws an `<li>` (focusable, so
 * «Altri passi» can hand the focus to the first it brought): the caller owns the `<ul>`.
 */
export const RassegnaResult = forwardRef<HTMLLIElement, Props>(function RassegnaResult({ passo, q, onOpenArticle, opened = false }, ref) {
  const textId = useId();
  const [whole, setWhole] = useState(opened);
  const spans = useMemo(() => findWords(passo.testo, q), [passo.testo, q]);
  // opened on the longest word searched, else on the first word found
  const start = useMemo(() => {
    const anchor = findWords(passo.testo, anchorWord(q));
    return excerptStart(passo.testo, anchor.length > 0 ? anchor : spans);
  }, [passo.testo, q, spans]);
  const articles = useMemo(() => passo.articoli.map(articleLink), [passo.articoli]);
  const cut = start > 0 || passo.testo.length > LONG;

  return (
    <li ref={ref} tabIndex={-1} className="space-y-2 py-4 focus:outline-none">
      <div className="space-y-0.5">
        <p className="text-xs text-slate-600 dark:text-slate-400">{provenance(passo)}</p>
        {passo.autori.length > 0 && <p className="text-xs italic text-slate-500 dark:text-slate-400">di {passo.autori.join(', ')}</p>}
      </div>
      <p id={textId} className={cn('text-sm leading-relaxed text-slate-800 dark:text-slate-200', !whole && cut && 'line-clamp-4')}>
        {!whole && start > 0 && <span className="text-slate-500 dark:text-slate-400">… </span>}
        {marked(passo.testo, spans, whole ? 0 : start)}
      </p>
      {cut && (
        <Button variant="link" aria-expanded={whole} aria-controls={textId} onClick={() => setWhole((v) => !v)}>
          {whole ? 'Mostra meno' : 'Leggi tutto il passo'}
        </Button>
      )}
      {articles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-600 dark:text-slate-400">Articoli citati:</span>
          {articles.map(({ label, params }, i) => (params ? (
            <Button key={`${passo.articoli[i].urn}`} variant="secondary" onClick={() => onOpenArticle(params)}>
              {label}
            </Button>
          ) : (
            <span key={`${passo.articoli[i].urn}`} className="px-2 py-0.5 text-xs text-slate-600 dark:text-slate-400">{label}</span>
          )))}
        </div>
      )}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Fonte: Ufficio del Massimario della Corte di cassazione ·{' '}
        <a href={passo.url} target="_blank" rel="noopener noreferrer" className={cn('underline hover:text-slate-800 dark:hover:text-slate-200', FOCUS_RING)}>
          Apri sul portale del Massimario
        </a>
      </p>
      <AddPassageToPratica passo={passo} />
    </li>
  );
});
