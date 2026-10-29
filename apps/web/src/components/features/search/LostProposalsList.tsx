import type { Highlight, HighlightProposal, Proposal } from '../../../types';
import type { ProposalActions } from './BlockAnnotationsPopover';
import { ProposalCard } from './ProposalCard';
import { GlossCard } from './GlossCard';
import { GLOSS_WORDS } from '../../../constants/glossWords';

export interface LostProposalsListProps {
    /** The proposals no block's sign shows: their words are no longer in the text on screen. */
    proposals: (Highlight & { proposal: HighlightProposal })[];
    actions: ProposalActions;
}

/**
 * The passages an application proposed on a dossier entry whose words are no longer in the text shown (D7b): under
 * the text at every width, said to be the application's, each with its note and the popover's own actions
 * (`ProposalCard`), so the row's light never counts one the reader cannot find.
 */
export function LostProposalsList({ proposals, actions }: LostProposalsListProps) {
    if (proposals.length === 0) return null;
    return (
        <section
            aria-label={`Proposte dell'IA non più nel testo (${proposals.length})`}
            className="mt-6 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/20"
        >
            <h5 className="font-semibold text-slate-700 dark:text-slate-200">Proposte dell'IA non più nel testo</h5>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Le parole su cui l'IA le aveva proposte non sono nel testo mostrato.
            </p>
            <ul className="mt-2 space-y-2">
                {proposals.map((p) => (
                    <li key={p.id}>
                        <ProposalCard
                            highlight={p}
                            onValidate={(validated) => actions.validate(p.id, validated)}
                            onFlag={(flagged) => actions.flag(p.id, flagged)}
                            onReviewComment={(text) => actions.comment(p.id, text)}
                            onEditNote={(text) => actions.editNote(p.id, text)}
                            onRemove={() => actions.remove(p.id)}
                            onMove={actions.move && (() => actions.move!(p.id))}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
}

/**
 * The glosses an application wrote on a dossier entry whose words are no longer in the text shown (D8): under the text
 * at every width, as the passages' list, each card with its actions («Sposta» puts it on new words).
 */
export function LostGlossesList({ glosses, actions }: { glosses: readonly Proposal[]; actions: ProposalActions }) {
    if (glosses.length === 0) return null;
    return (
        <section
            aria-label={`${GLOSS_WORDS.lostTitle} (${glosses.length})`}
            className="mt-6 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/20"
        >
            <h5 className="font-semibold text-slate-700 dark:text-slate-200">{GLOSS_WORDS.lostTitle}</h5>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{GLOSS_WORDS.lostHelp}</p>
            <ul className="mt-2 space-y-2">
                {glosses.map((g) => (
                    <li key={g.id}>
                        <GlossCard gloss={g} actions={actions} />
                    </li>
                ))}
            </ul>
        </section>
    );
}
