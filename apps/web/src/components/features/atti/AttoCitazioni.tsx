import { Link, useNavigate } from 'react-router-dom';
import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import { useAttoCitazioni, type CitationCheck, type Verdict } from './useAttoCitazioni';

const MARKS: Record<Verdict, { icon: typeof CircleCheck; className: string }> = {
  checking: { icon: LoaderCircle, className: 'text-slate-500 motion-safe:animate-spin dark:text-slate-400' },
  verified: { icon: CircleCheck, className: 'text-emerald-600 dark:text-emerald-400' },
  attention: { icon: CircleAlert, className: 'text-amber-600 dark:text-amber-400' },
  unchecked: { icon: CircleDashed, className: 'text-slate-500 dark:text-slate-400' },
};
const ROW = 'flex min-h-11 w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-slate-100 md:min-h-0 dark:hover:bg-slate-800';

function RowBody({ check }: { check: CitationCheck }) {
  const { icon: Icon, className } = MARKS[check.verdict];
  return (
    <>
      {/* The words below carry the state: the mark is only a sign for the eye. */}
      <Icon aria-hidden size={18} className={cn('mt-0.5 shrink-0', className)} />
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-[15px] leading-snug text-slate-900 dark:text-slate-100">{check.label}</span>
        <span className="block text-[13px] leading-snug text-slate-700 dark:text-slate-300">{check.words}</span>
        {check.detail && <span className="block text-[13px] leading-snug text-slate-600 dark:text-slate-400">{check.detail}</span>}
      </span>
    </>
  );
}

/**
 * «Citazioni», beside the act's text: the norms and decisions it cites, each with what the source says of it (verified,
 * not found, ambiguous, or not checked because the source was silent). A row opens the norm or decision as the rest of
 * the app does. The check follows the text with a pause (`useAttoCitazioni`).
 */
export function AttoCitazioni({ testo, className }: { testo: string; className?: string }) {
  const { checks, ready, failed } = useAttoCitazioni(testo);
  const navigate = useNavigate();
  const triggerSearch = useAppStore((s) => s.triggerSearch);

  // As «Analizza documento» opens a citation: the search runs on the reader's page, so go there first.
  const openNorm = (norm: ParsedCitationData) => {
    navigate('/');
    triggerSearch({
      act_type: norm.act_type,
      act_number: norm.act_number ?? '',
      date: norm.date ?? '',
      article: norm.article,
      ...(norm.annex ? { annex: norm.annex } : {}),
      version: 'vigente',
      version_date: '',
    });
  };

  const attention = checks.filter((c) => c.verdict === 'attention').length;
  return (
    <section aria-labelledby="atto-citazioni" className={cn('flex flex-col gap-2', className)}>
      <h2 id="atto-citazioni" tabIndex={-1} className="text-sm font-medium focus:outline-none text-slate-700 dark:text-slate-300">Citazioni</h2>
      {failed ? (
        <p role="alert" className="text-sm text-slate-700 dark:text-slate-300">Non è stato possibile leggere le citazioni del testo. Riprova a modificarlo o riapri l’atto.</p>
      ) : !ready ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Controllo delle citazioni…</p>
      ) : checks.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Nel testo non ci sono norme né sentenze citate.</p>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {checks.length === 1 ? '1 citazione' : `${checks.length} citazioni`}{attention > 0 ? `, ${attention} da controllare` : ''}
          </p>
          <ul className="flex flex-col">
            {checks.map((check) => {
              const { target } = check;
              return (
                <li key={check.key}>
                  {'norm' in target ? (
                    <button type="button" onClick={() => openNorm(target.norm)} className={cn(ROW, FOCUS_RING)}><RowBody check={check} /></button>
                  ) : (
                    <Link to={target.path} className={cn(ROW, FOCUS_RING)}><RowBody check={check} /></Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
