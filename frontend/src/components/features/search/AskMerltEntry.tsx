import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircleQuestion, Sparkles } from 'lucide-react';
import { ConsentDialog } from '../../../features/merlt/consent/ConsentDialog';

/**
 * Snooze for the consent-none teaser chip. Namespaced like the other MERL-T
 * local keys (`visualex.merlt.*`); once dismissed it does not reappear for
 * TEASER_SNOOZE_MS. Choosing any consent level makes the teaser moot (the entry
 * flips to the real "Chiedi" button), so no explicit clear is needed here.
 */
export const ASK_TEASER_SNOOZE_KEY = 'visualex.merlt.ask-teaser-dismissed';
const TEASER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function isAskTeaserSnoozed(): boolean {
    try {
        const raw = localStorage.getItem(ASK_TEASER_SNOOZE_KEY);
        if (!raw) return false;
        const until = Number(raw);
        return Number.isFinite(until) && Date.now() < until;
    } catch {
        return false;
    }
}

function persistAskTeaserSnooze(): void {
    try {
        localStorage.setItem(ASK_TEASER_SNOOZE_KEY, String(Date.now() + TEASER_SNOOZE_MS));
    } catch {
        /* localStorage unavailable — the in-memory dismiss still applies */
    }
}

/** Human article heading, e.g. "Art. 2043 codice civile". */
function buildHeading(articleNumber: string, actType: string, actNumber?: string, annex?: string): string {
    return `Art. ${articleNumber}${annex ? ` (All. ${annex})` : ''} ${actType}${actNumber ? ` n. ${actNumber}` : ''}`
        .replace(/\s+/g, ' ')
        .trim();
}

export interface AskMerltEntryProps {
    merltEnabled: boolean;
    /** Q&A queryable (consent ≥ basic). Shows the real "Chiedi" action. */
    qaAskable: boolean;
    /** Consent is `none` — shows the teaser chip instead (opens the dialog). */
    consentNone: boolean;
    articleUrn: string | undefined;
    articleNumber: string;
    actType: string;
    actNumber?: string;
    annex?: string;
}

/**
 * Discreet in-context entry to the Q&A page — the question is born while reading
 * the norm (design §3.5). Follows the NER-row pattern: one unobtrusive line at
 * the end of the article body.
 *  - `qaAskable` (consent ≥ basic): a "Chiedi su questo articolo" button that
 *    navigates to /merlt/qa prefilled with the article context (QA-PREFILL
 *    CONTRACT: { prefillQuery, articleUrn, articleHeading }).
 *  - consent `none`: a one-off teaser chip that opens the consent dialog; its
 *    dismissal is persisted so it does not nag.
 *  - MERL-T disabled / any other state: renders nothing.
 */
export function AskMerltEntry({
    merltEnabled,
    qaAskable,
    consentNone,
    articleUrn,
    articleNumber,
    actType,
    actNumber,
    annex,
}: AskMerltEntryProps): React.ReactElement | null {
    const navigate = useNavigate();
    const [consentOpen, setConsentOpen] = useState(false);
    // Lazy initializer honours a persisted (unexpired) dismissal on mount.
    const [teaserDismissed, setTeaserDismissed] = useState(isAskTeaserSnoozed);

    const heading = buildHeading(articleNumber, actType, actNumber, annex);
    const prefillQuery = `Spiegami l'${heading.charAt(0).toLowerCase()}${heading.slice(1)}`;

    if (!merltEnabled) return null;

    if (qaAskable) {
        return (
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button
                    type="button"
                    onClick={() =>
                        navigate('/merlt/qa', {
                            state: { prefillQuery, articleUrn: articleUrn ?? '', articleHeading: heading },
                        })
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 transition-colors duration-150 hover:text-primary-700 focus-visible:outline-none focus-visible:underline dark:text-primary-400 dark:hover:text-primary-300"
                >
                    <MessageCircleQuestion size={14} />
                    Chiedi su questo articolo
                </button>
            </div>
        );
    }

    if (consentNone && !teaserDismissed) {
        return (
            <>
                <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={() => setConsentOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 transition-colors duration-150 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
                    >
                        <Sparkles size={13} />
                        Fai domande su questo articolo con MERL-T
                    </button>
                    <button
                        type="button"
                        aria-label="Nascondi il suggerimento"
                        onClick={() => {
                            setTeaserDismissed(true);
                            persistAskTeaserSnooze();
                        }}
                        className="text-xs text-slate-400 transition-colors duration-150 hover:text-slate-600 focus-visible:outline-none focus-visible:underline dark:hover:text-slate-300"
                    >
                        Non ora
                    </button>
                </div>
                <ConsentDialog open={consentOpen} onClose={() => setConsentOpen(false)} />
            </>
        );
    }

    return null;
}
