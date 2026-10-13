import { useEffect, useMemo, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { NormaVisitata } from '../../../types';
import type { EuCaseLawAnswer, EuCaseLawDecision } from '../../../types/decisions';
import { cn } from '../../../lib/utils';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import { euCaseLawQuery, eurLexDecisionUrl, INFOCURIA_SEARCH_URL } from '../../../utils/euCaseLaw';
import { searchEuCaseLawCached } from '../../../utils/euCaseLawCache';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import { Button } from '../../ui/Button';
import { CaseLawRow } from '../search/caseLaw/CaseLawRow';
import { useCaseLawFilters, useReportCaseLawYears } from '../search/caseLaw/caseLawFiltersContext';
import { applyCaseLawFilters, isNarrowing } from '../search/caseLaw/caseLawFilter';
import { rowYear, yearCounts, type YearsOf } from '../search/caseLaw/caseLawYears';

interface EuCaseLawBlockProps {
  /** The article of an act of the Union read here. */
  norma: Pick<NormaVisitata, 'tipo_atto' | 'data' | 'numero_atto' | 'numero_articolo'>;
  /** The place the article is read in (a practice or one of its windows): a judgment opens beside it. */
  besideId?: string;
  /** The way back to the article, recorded when a judgment is opened from here. */
  backEntry?: ReadingBackEntry;
}

const TIPO_LABEL: Record<EuCaseLawDecision['tipo'], string> = {
  JUDG: 'Sentenza',
  ORDER: 'Ordinanza',
  OPIN_AG: 'Conclusioni AG',
};

/** The day the source gives; a decision without one has no year and passes no range. */
const yearsOfDecision: YearsOf<EuCaseLawDecision> = (d) => rowYear({ date: d.data });
const labelOf = (d: EuCaseLawDecision): string => formatDecisionShort(d.identita);
const textOf = (d: EuCaseLawDecision): string => [labelOf(d), TIPO_LABEL[d.tipo], d.ecli ?? '', d.celex].join(' ');

type Problem = Exclude<EuCaseLawAnswer, { esito: 'risultati' }>;

const problemMessage = (problem: Problem): string => {
  switch (problem.esito) {
    case 'non_supportata':
      return 'Le decisioni della Corte di giustizia sono elencate per i regolamenti e le direttive, non per i Trattati.';
    case 'richiesta_non_valida':
      return 'La ricerca non è valida per questo articolo.';
    case 'errore_interno':
      return 'La ricerca non è riuscita per un errore dell’applicazione.';
    case 'fonte_non_raggiungibile':
      return problem.fonte === 'quota'
        ? 'Hai fatto troppe ricerche in poco tempo: riprova tra qualche minuto.'
        : 'Gli indici dell’Unione europea non rispondono in questo momento.';
  }
};

/**
 * The Court of Justice's and the General Court's decisions that cite an article of a regulation or a
 * directive (case-law section spec, D1), from the Union's indexes. Loaded when the block appears (the
 * section opens), once per act and article for the session. A judgment opens in VisuaLex's reader of
 * the Union's courts; an order or an Advocate General's opinion, which that reader does not hold, opens
 * on EUR-Lex. The opinions are hidden until asked for. The section's years and text narrow the list.
 */
export function EuCaseLawBlock({ norma, besideId, backEntry }: EuCaseLawBlockProps) {
  const filters = useCaseLawFilters();
  const { tipo_atto, data, numero_atto, numero_articolo } = norma;
  const query = useMemo(
    () => euCaseLawQuery({ tipo_atto, data, numero_atto, numero_articolo }),
    [tipo_atto, data, numero_atto, numero_articolo],
  );
  const [attempt, setAttempt] = useState(0);
  const [showOpinions, setShowOpinions] = useState(false);
  // the answer is tied to the question it answers, so a new article or «Riprova» shows "loading" without
  // a state set in the effect
  const asked = query ? `${query.celex}|${query.articolo}|${attempt}` : null;
  const [result, setResult] = useState<{ asked: string; answer: EuCaseLawAnswer } | null>(null);

  useEffect(() => {
    if (!query || !asked) return;
    let current = true;
    searchEuCaseLawCached(query)
      .catch((error): EuCaseLawAnswer => {
        console.error('search_eu_case_law: no answer', error);
        return { esito: 'fonte_non_raggiungibile', fonte: 'rete' };
      })
      .then((answer) => {
        if (current) setResult({ asked, answer });
      });
    return () => { current = false; };
  }, [query, asked]);

  const answer = result && result.asked === asked ? result.answer : null;
  const listed = answer?.esito === 'risultati' ? answer : null;
  const opinions = useMemo(() => (listed ? listed.decisioni.filter((d) => d.tipo === 'OPIN_AG') : []), [listed]);
  // the opinions are out of the list, and out of the counts, until asked for
  const eligible = useMemo(
    () => (listed ? listed.decisioni.filter((d) => showOpinions || d.tipo !== 'OPIN_AG') : []),
    [listed, showOpinions],
  );
  const counts = useMemo(() => yearCounts(eligible, yearsOfDecision), [eligible]);
  useReportCaseLawYears('eu', counts);

  // The query stops at its newest 500: the oldest first is then the oldest of those, not the Union's,
  // so the order the reader asks for applies to a complete list only
  const orderHeld = filters.order === 'asc' && Boolean(listed?.troncato);
  const shown = useMemo(
    () => applyCaseLawFilters(eligible, { yearsOf: yearsOfDecision, textOf }, orderHeld ? { ...filters, order: 'desc' } : filters),
    [eligible, filters, orderHeld],
  );

  if (!query) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{problemMessage({ esito: 'non_supportata' })}</p>;
  }
  if (!answer) {
    return <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Ricerca negli indici dell’Unione europea…</p>;
  }
  if (!listed) {
    return (
      <div role="alert" className="text-sm text-slate-700 dark:text-slate-200">
        <p>{problemMessage(answer as Problem)}</p>
        {(answer.esito === 'fonte_non_raggiungibile' || answer.esito === 'errore_interno') && (
          <div className="mt-2">
            <Button variant="secondary" size="sm" icon={<RotateCw size={16} />} className={TOUCH_TARGET_RESPONSIVE} onClick={() => setAttempt((n) => n + 1)}>
              Riprova
            </Button>
          </div>
        )}
      </div>
    );
  }

  const narrowing = isNarrowing(filters);
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Dagli indici dell’Unione europea: l’elenco può essere incompleto.{' '}
        <a href={INFOCURIA_SEARCH_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-slate-200">
          Cerca su InfoCuria
        </a>
        {listed.troncato && ' L’elenco si ferma alle 500 decisioni più recenti.'}
      </p>

      {opinions.length > 0 && (
        <button
          type="button"
          aria-pressed={showOpinions}
          onClick={() => setShowOpinions((v) => !v)}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            TOUCH_TARGET_RESPONSIVE,
            showOpinions
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800',
          )}
        >
          {`Conclusioni dell’Avvocato generale (${opinions.length})`}
        </button>
      )}

      {eligible.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {listed.decisioni.length === 0
            ? 'Nessuna decisione indicizzata cita questo articolo.'
            : 'Nessuna sentenza o ordinanza indicizzata cita questo articolo: restano le Conclusioni dell’Avvocato generale.'}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {narrowing
              ? `${shown.length} di ${eligible.length} decisioni`
              : `${eligible.length} ${eligible.length === 1 ? 'decisione' : 'decisioni'}`}
          </p>
          {orderHeld && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ordinate dalla più recente: l’ordine inverso vale quando l’elenco è completo
            </p>
          )}
          {shown.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nessuna decisione corrisponde ai filtri selezionati.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {shown.map((d) => {
                // a judgment opens in our reader; an order or an opinion is not in it, so it opens where it is published
                const eurLex = d.tipo === 'JUDG' ? null : eurLexDecisionUrl(d.celex);
                return (
                  <CaseLawRow
                    key={d.celex}
                    decision={d.tipo === 'JUDG' ? d.identita : null}
                    label={labelOf(d)}
                    authority="CGUE"
                    date={d.data}
                    detail={d.ecli ?? undefined}
                    badges={[TIPO_LABEL[d.tipo]]}
                    source="EUR-Lex"
                    externalHref={eurLex ?? undefined}
                    externalNote={eurLex ? 'su EUR-Lex' : undefined}
                    besideId={besideId}
                    backEntry={backEntry}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      <p className="text-[11px] text-slate-400">Fonte: EUR-Lex / Ufficio delle pubblicazioni dell’UE</p>
    </div>
  );
}
