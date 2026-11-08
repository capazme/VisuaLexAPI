import { useCallback, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { DecisionIdentity } from '../../../types/decisions';
import { decisionPath, formatDecisionShort } from '../../../utils/decisionLinks';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../studia/progress/tokens';
import { DecisionView } from '../decisions/DecisionView';
import { DecisionReadingSurface } from '../decisions/DecisionReadingSurface';
import { DecisionDiscussionsWithoutText } from '../decisions/DecisionDiscussionsWithoutText';
import { useDecisionAnswer } from '../decisions/useDecisionAnswer';
import { CitedNormsContext } from './useCitedNorms';

interface Props {
  identity: DecisionIdentity;
  /** Its dossier entry: what an application proposed on it is drawn on its text (D7b). */
  itemId?: string;
}

/**
 * A decision of the dossier read in its row (D7a), as an article is (`DossierItemReader`): the decision's own reader,
 * never another — `useDecisionAnswer` through the session cache, `DecisionView` with the reading surface
 * (`DecisionReadingSurface`: the text as received, the notes and highlights on it, the key passages, gotcha 23), and,
 * when the decision came without its text, the anchors and discussions on it (`DecisionView` says how it came). Its
 * address stays one click away, «Apri la sentenza», over the decision whatever came back (an answer not found or a
 * source that is silent included). No tab holds it: the find window has nothing of it to search. A norm it cites is the
 * dossier's to open (D7d, `CitedNormsContext`): one the dossier holds opens in the norms' column, the rest are offered;
 * a decision it cites opens in the workspace, which the page goes to. Nothing is recorded in the Cronologia, as for an
 * article read here.
 */
export function DossierDecisionReader({ identity, itemId }: Props) {
  const navigate = useNavigate();
  const openPaletteWith = useAppStore((s) => s.openCommandPaletteWith);
  const { current, answer, retry, chooseCandidate } = useDecisionAnswer(identity);
  const toWorkspace = useCallback(() => navigate('/'), [navigate]);
  const citedNorms = useContext(CitedNormsContext) ?? undefined;

  return (
    <div className="space-y-2">
      <Link
        to={decisionPath(identity)}
        // 44 px on a phone, 36 from md, as the decision's own actions.
        className={cn('-ml-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm text-primary-700 hover:underline md:min-h-9 dark:text-primary-300', FOCUS_RING)}
      >
        <ArrowUpRight size={16} aria-hidden /> Apri la sentenza
      </Link>
      <DecisionView
        answer={answer}
        reference={current}
        onRetry={retry}
        onChooseCandidate={chooseCandidate}
        onOpenPalette={() => openPaletteWith(formatDecisionShort(current))}
        // The row names the decision: its full heading as a line of details, not a second title (D7a).
        title="line"
        textSlot={answer?.esito === 'trovata' ? (
          <DecisionReadingSurface identity={answer.identita} testo={answer.testo} attributi={answer.attributi} onLeave={toWorkspace} citedNorms={citedNorms} dossierItemId={itemId} />
        ) : undefined}
        noTextSlot={answer?.esito === 'trovata' ? (
          <DecisionDiscussionsWithoutText identity={answer.identita} attributi={answer.attributi} />
        ) : undefined}
      />
    </div>
  );
}
