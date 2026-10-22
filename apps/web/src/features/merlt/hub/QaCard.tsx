import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { HubAction, HubCard } from './HubCard';
import { HUB_NOTE, HUB_QUIET_BUTTON, HUB_TEXT } from './hubStyles';
import type { AsyncSlice } from './useHubData';
import type { QaHistoryItem } from '../qa/types';

/**
 * Assistente Q&A card (§3.3). Data-bearing: shows the last question + its
 * answer-confidence chip; the question itself takes it up again ("Riprendi":
 * prefill the composer with it), the card's action asks a new one. Empty state
 * offers one example question.
 *
 * Gated at `basic` (qaAskable): reading is free, asking needs consent. When not
 * askable the action says so (S7b) instead of an error.
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

  const asked = lastQa.status === 'success' && lastQa.data;
  const action = !qaAskable ? (
    <HubAction gated="Serve il consenso base" />
  ) : (
    <HubAction onClick={() => goAsk()}>{asked ? 'Nuova domanda' : 'Fai una domanda'}</HubAction>
  );

  return (
    <HubCard testId="hub-card-qa" icon={MessageSquare} title="Assistente Q&A" action={action}>
      {!qaAskable ? (
        <p className={HUB_TEXT}>Fai domande giuridiche al sistema multi-expert.</p>
      ) : lastQa.status === 'loading' ? (
        <p className={HUB_NOTE}>Caricamento…</p>
      ) : lastQa.status === 'error' ? (
        <p className={HUB_TEXT}>Cronologia non raggiungibile al momento.</p>
      ) : lastQa.status === 'success' && lastQa.data ? (
        <>
          <p className={HUB_NOTE}>Ultima domanda</p>
          <button type="button" onClick={() => goAsk(lastQa.data?.query)} className={`mt-1 ${HUB_QUIET_BUTTON}`}>
            <span className="line-clamp-2 font-medium">{lastQa.data.query}</span>
            <span className="mt-1 block text-[13px] font-medium text-primary-700 dark:text-primary-300">Riprendi</span>
          </button>
          {confidenceLabel(lastQa.data.confidence) && (
            <span className="mt-2 inline-flex w-fit items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-950/40 dark:text-primary-300">
              {confidenceLabel(lastQa.data.confidence)}
            </span>
          )}
        </>
      ) : (
        // success + null → the user has never asked
        <>
          <p className={HUB_TEXT}>Non hai ancora fatto domande. Prova con un esempio:</p>
          <button type="button" onClick={() => goAsk(EXAMPLE_QUESTION)} className={`mt-2 ${HUB_QUIET_BUTTON}`}>
            “{EXAMPLE_QUESTION}”
          </button>
        </>
      )}
    </HubCard>
  );
}
