import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { HubCard, StatusPill } from './HubCard';
import type { AsyncSlice } from './useHubData';
import type { QaHistoryItem } from '../qa/types';

/**
 * Assistente Q&A card (§3.3). Data-bearing: shows the last question + its
 * answer-confidence chip, with "Riprendi" (prefill the composer with the last
 * question) and "Nuova domanda". Empty state offers one example question.
 *
 * Gated at `basic` (qaAskable): reading is free, asking needs consent. When not
 * askable the card shows a gated pill + upsell instead of an error.
 */

const EXAMPLE_QUESTION = 'Cosa distingue il dolo dalla colpa nella responsabilità civile?';

export interface QaCardProps {
  qaAskable: boolean;
  lastQa: AsyncSlice<QaHistoryItem | null>;
}

function confidenceLabel(confidence: number | null | undefined): string | null {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  return `${pct}% affidabilità`;
}

export function QaCard({ qaAskable, lastQa }: QaCardProps) {
  const navigate = useNavigate();

  // Slice 4 absorb (Decision A): the graph is the sole Q&A surface. The prefill
  // contract (QA-PREFILL) rides in location.state; GraphExplorerPage reads it
  // once on mount to seed the "Chiedi al grafo" field.
  const goAsk = (prefillQuery?: string) => {
    navigate('/grafo', prefillQuery ? { state: { prefillQuery } } : undefined);
  };

  const pill = !qaAskable ? <StatusPill tone="gated">Consenso base</StatusPill> : undefined;

  return (
    <HubCard testId="hub-card-qa" icon={MessageSquare} title="Assistente Q&A" pill={pill}>
      {!qaAskable ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Fai domande giuridiche al sistema multi-expert.
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Per fare domande serve almeno il consenso <strong>base</strong>.
          </p>
        </>
      ) : lastQa.status === 'loading' ? (
        <p className="text-sm text-slate-400">Caricamento…</p>
      ) : lastQa.status === 'error' ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Cronologia non raggiungibile al momento.
          </p>
          <div className="mt-auto pt-3">
            <Button variant="primary" size="sm" onClick={() => goAsk()}>
              Nuova domanda
            </Button>
          </div>
        </>
      ) : lastQa.status === 'success' && lastQa.data ? (
        <>
          <p className="text-xs uppercase tracking-wide text-slate-400">Ultima domanda</p>
          <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-100">
            {lastQa.data.query}
          </p>
          {confidenceLabel(lastQa.data.confidence) && (
            <span className="mt-2 inline-flex w-fit items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              {confidenceLabel(lastQa.data.confidence)}
            </span>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-3">
            <Button variant="secondary" size="sm" onClick={() => goAsk(lastQa.data?.query)}>
              Riprendi
            </Button>
            <Button variant="primary" size="sm" onClick={() => goAsk()}>
              Nuova domanda
            </Button>
          </div>
        </>
      ) : (
        // success + null → the user has never asked
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Non hai ancora fatto domande. Prova con un esempio:
          </p>
          <button
            type="button"
            onClick={() => goAsk(EXAMPLE_QUESTION)}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            “{EXAMPLE_QUESTION}”
          </button>
        </>
      )}
    </HubCard>
  );
}
