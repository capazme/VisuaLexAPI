import { useNavigate } from 'react-router-dom';
import { MessageCircleQuestion } from 'lucide-react';
import { shortNorm } from '../../../utils/sources';

/** The article's short label (source convention): «art. 2043 c.c.», «art. 2 l. 241/1990». */
function buildHeading(articleNumber: string, actType: string, actNumber?: string, annex?: string, actDate?: string, actRealType?: string): string {
    return shortNorm({ tipo_atto: actType, tipo_atto_reale: actRealType, numero_atto: actNumber, data: actDate, allegato: annex, numero_articolo: articleNumber });
}

export interface AskMerltEntryProps {
    merltEnabled: boolean;
    /** Q&A queryable (consent ≥ basic). Shows the real "Chiedi" action. */
    qaAskable: boolean;
    articleUrn: string | undefined;
    articleNumber: string;
    actType: string;
    actNumber?: string;
    /** The act's date, for its short label («art. 2 l. 241/1990»). */
    actDate?: string;
    /** The act's real type when `actType` is an aliased code's name. */
    actRealType?: string;
    annex?: string;
}

/**
 * Discreet in-context entry to the deliberation surface — the question is born
 * while reading the norm (design §3.5). Follows the NER-row pattern: one
 * unobtrusive line at the end of the article body.
 *  - `qaAskable` (consent ≥ basic): a "Chiedi su questo articolo" button that
 *    navigates to /grafo (Slice 4 absorb, Decision A). It carries the QA-PREFILL
 *    CONTRACT ({ prefillQuery, articleUrn, articleHeading }) in location.state
 *    AND ?urn= in the query so the graph centers on the article on arrival.
 *  - MERL-T disabled / consent `none`: renders nothing. The consent is asked once, by the
 *    consent screen, never from inside the work (the owner, 12 October 2026).
 */
export function AskMerltEntry({
    merltEnabled,
    qaAskable,
    articleUrn,
    articleNumber,
    actType,
    actNumber,
    actDate,
    actRealType,
    annex,
}: AskMerltEntryProps): React.ReactElement | null {
    const navigate = useNavigate();

    const heading = buildHeading(articleNumber, actType, actNumber, annex, actDate, actRealType);
    const prefillQuery = `Spiegami l'${heading.charAt(0).toLowerCase()}${heading.slice(1)}`;

    if (!merltEnabled) return null;

    if (qaAskable) {
        return (
            // 44 px to tap on a phone (M1), the words as they were: the row's padding goes into the button there.
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 md:pt-3 dark:border-slate-800">
                <button
                    type="button"
                    onClick={() =>
                        navigate(
                            // ?urn= centers the graph on the article; location.state
                            // carries the QA-PREFILL CONTRACT for the ask field.
                            articleUrn ? `/grafo?urn=${encodeURIComponent(articleUrn)}` : '/grafo',
                            {
                                state: { prefillQuery, articleUrn: articleUrn ?? '', articleHeading: heading },
                            },
                        )
                    }
                    className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium md:min-h-0 text-primary-600 transition-colors duration-150 hover:text-primary-700 focus-visible:outline-none focus-visible:underline dark:text-primary-400 dark:hover:text-primary-300"
                >
                    <MessageCircleQuestion size={14} />
                    Chiedi su questo articolo
                </button>
            </div>
        );
    }

    return null;
}
