import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { CorteCostMassima, CorteCostMassimeAnswer } from '../../../types/decisions';
import { cn } from '../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { formatDateItalianLong } from '../../../utils/dateUtils';
import { searchCorteCostMassime } from '../../../services/corteCostMassimeService';
import { creditHref, getCredit } from '../../../data/credits';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import { Button } from '../../ui/Button';
import { CaseLawRow } from '../search/caseLaw/CaseLawRow';

interface CorteCostMassimeBlockProps {
  /** The article's identity, as `norma_data.urn` gives it. */
  articleUrn: string;
  /** An article of the Costituzione: the massime where it is at issue first, the rest on request (G-289). */
  constitution?: boolean;
  /** Where a decision opens beside (a practice or one of its windows), and the way back. */
  besideId?: string;
  backEntry?: ReadingBackEntry;
}

type Listed = Extract<CorteCostMassimeAnswer, { esito: 'risultati' }>;
type Problem = Exclude<CorteCostMassimeAnswer, { esito: 'risultati' }>;

const CREDIT_ID = 'corte-costituzionale';
const formatCount = (n: number): string => new Intl.NumberFormat('it-IT').format(n);

const TIPO_LABEL = { sentenza: 'Sentenza', ordinanza: 'Ordinanza' } as const;
const RUOLO_LABEL = { norma: 'Norma oggetto', parametro: 'Parametro' } as const;

const problemMessage = (problem: Problem): string => {
  if (problem.esito === 'fonte_non_raggiungibile' && problem.in_preparazione) {
    return 'Le massime della Corte costituzionale si stanno preparando: riprova tra un minuto.';
  }
  if (problem.esito === 'fonte_non_raggiungibile' && problem.fonte === 'quota') {
    return 'Hai fatto troppe ricerche in poco tempo: riprova tra qualche minuto.';
  }
  if (problem.esito === 'richiesta_non_valida') return 'Per questo articolo le massime non si possono cercare.';
  return 'I dati aperti della Corte costituzionale non sono raggiungibili in questo momento.';
};

/**
 * The Corte costituzionale's massime that name the article, from the Court's open data (G-281): a
 * separate collection, each text as the Court published it, with the source and its licence. A
 * deliberately plain first version: the design of the block is Inchiostro's (Luca), and it does not
 * yet take the section's year and text filters, which would narrow only the page loaded. Loaded when
 * the block appears (the section opens); 20 at a time, the newest decision first. On the Costituzione,
 * where an article is the measure of thousands of massime, it asks first for those where the article
 * is the provision at issue, and «anche come parametro» adds the others (G-289). The line under the
 * massime is the credits' own entry, linked to it (G-287).
 */
export function CorteCostMassimeBlock({ articleUrn, constitution = false, besideId, backEntry }: CorteCostMassimeBlockProps) {
  const [attempt, setAttempt] = useState(0);
  // the article «anche come parametro» was chosen for: another article starts from the massime at issue again
  const [withParameterFor, setWithParameterFor] = useState<string | null>(null);
  const ruolo = constitution && withParameterFor !== articleUrn ? 'norma' : undefined;
  // the answer is tied to the article and the role it answers, so another one shows "loading" without a state set in the effect
  const asked = `${articleUrn}|${ruolo ?? ''}|${attempt}`;
  const [result, setResult] = useState<{ asked: string; answer: CorteCostMassimeAnswer } | null>(null);
  const [more, setMore] = useState<{ asked: string; massime: CorteCostMassima[]; pagina: number } | null>(null);
  // which article's next page is on its way, and which one's failed: another article starts clean
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [moreFailed, setMoreFailed] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    searchCorteCostMassime(articleUrn, 1, ruolo)
      .catch((error): CorteCostMassimeAnswer => {
        console.error('search_corte_cost_massime: no answer', error);
        return { esito: 'fonte_non_raggiungibile', fonte: 'rete' };
      })
      .then((answer) => {
        if (current) setResult({ asked, answer });
      });
    return () => { current = false; };
  }, [articleUrn, ruolo, asked]);

  const answer = result && result.asked === asked ? result.answer : null;
  if (!answer) {
    return <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Ricerca nelle massime della Corte costituzionale…</p>;
  }
  if (answer.esito !== 'risultati') {
    return (
      <div role="alert" className="text-sm text-slate-700 dark:text-slate-200">
        <p>{problemMessage(answer)}</p>
        {answer.esito !== 'richiesta_non_valida' && (
          <div className="mt-2">
            <Button variant="secondary" size="sm" icon={<RotateCw size={16} />} className={TOUCH_TARGET_RESPONSIVE} onClick={() => setAttempt((n) => n + 1)}>
              Riprova
            </Button>
          </div>
        )}
      </div>
    );
  }

  const listed: Listed = answer;
  const extra = more && more.asked === asked ? more : null;
  const shown = extra ? [...listed.massime, ...extra.massime] : listed.massime;
  const lastPage = extra ? extra.pagina : listed.pagina;

  const loading = loadingMore === asked;
  const loadMore = () => {
    setLoadingMore(asked);
    setMoreFailed(null);
    searchCorteCostMassime(articleUrn, lastPage + 1, ruolo)
      .then((next) => {
        if (next.esito !== 'risultati') {
          setMoreFailed(asked);
          return;
        }
        // the index is rebuilt daily: a page read after new massime came in repeats the last rows
        const seen = new Set(shown.map((m) => m.numero));
        const fresh = next.massime.filter((m) => !seen.has(m.numero));
        setMore({ asked, massime: [...(extra?.massime ?? []), ...fresh], pagina: next.pagina });
      })
      .catch((error) => {
        console.error('search_corte_cost_massime: no answer', error);
        setMoreFailed(asked);
      })
      .finally(() => setLoadingMore((current) => (current === asked ? null : current)));
  };

  // in a new tab, so the reader's practice stays where it is
  const credit = (
    <p className="text-[11px] text-slate-500 dark:text-slate-400">
      <a href={creditHref(CREDIT_ID)} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-slate-200">
        {getCredit(CREDIT_ID).attribution}
      </a>
      {listed.aggiornato_al && ` · aggiornate al ${formatDateItalianLong(listed.aggiornato_al)}`}
    </p>
  );

  const asParameter = listed.per_ruolo.parametro;
  const parameterSwitch = constitution && (ruolo === undefined || asParameter > 0) && (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200', TOUCH_TARGET_RESPONSIVE)}>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        checked={ruolo === undefined}
        onChange={(e) => setWithParameterFor(e.target.checked ? articleUrn : null)}
      />
      <span>Anche come parametro ({formatCount(asParameter)})</span>
    </label>
  );

  if (listed.totale === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {ruolo === 'norma'
            ? 'Nessuna massima della Corte costituzionale ha questo articolo come norma oggetto.'
            : 'Nessuna massima della Corte costituzionale nomina questo articolo.'}
        </p>
        {parameterSwitch}
        {credit}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {credit}
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {listed.totale === 1 ? '1 massima' : `${formatCount(listed.totale)} massime`}
        {ruolo === 'norma' && ' in cui l’articolo è norma oggetto'}
      </p>
      {parameterSwitch}
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {shown.map((m) => (
          <CaseLawRow
            key={m.numero}
            decision={m.pronuncia.identita}
            authority="Corte cost."
            date={m.pronuncia.data_deposito ?? m.pronuncia.data_decisione}
            year={m.pronuncia.identita.anno}
            badges={[
              ...(m.pronuncia.tipo ? [TIPO_LABEL[m.pronuncia.tipo]] : []),
              ...m.ruoli.map((r) => RUOLO_LABEL[r]),
              `mass. ${m.numero}`,
            ]}
            source="Corte costituzionale"
            context={m.titolo ? <p className="text-xs text-slate-500 dark:text-slate-400">{m.titolo}</p> : undefined}
            besideId={besideId}
            backEntry={backEntry}
          >
            {m.testo}
          </CaseLawRow>
        ))}
      </ul>
      {moreFailed === asked && (
        <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">Le altre massime non sono arrivate: riprova.</p>
      )}
      {shown.length < listed.totale && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className={cn(
            'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800',
            TOUCH_TARGET_RESPONSIVE,
          )}
        >
          {loading ? 'Caricamento…' : `Mostra altre massime (${formatCount(listed.totale - shown.length)})`}
        </button>
      )}
    </div>
  );
}
