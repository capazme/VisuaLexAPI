import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ChevronDown, Gavel, Search, WifiOff, CircleAlert, ExternalLink, RotateCw } from 'lucide-react';
import type { Decisione, MassimaStructured, NormaVisitata, SourceResult } from '../../../types';
import { cn } from '../../../lib/utils';
import { SkeletonText } from '../../ui/Skeleton';
import { buildCaseLawReference, fetchCaseLawCached, isUnsearchableActType } from '../../../services/caseLawService';
import { LegalApiError } from '../../../services/legalApi';
import { parseItalianDate, formatDateItalianLong } from '../../../utils/dateUtils';
import { LinkKindBadge } from './LinkKindBadge';
import { MassimeSection } from './MassimeSection';

// Per-source cap on a fan-out to four sources. Even inline (no 380px
// constraint any more), a source with hits should read as a short, curated
// list rather than a wall of cards — the backend default (10/source, up to
// 40 cards) is still more than a lawyer wants to scan per article.
const RESULTS_PER_SOURCE = 5;

type ReferenceNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo'>;

export interface GiurisprudenzaSectionHandle {
    /** Expands the section (if collapsed) and scrolls it into view — what the
     * toolbar's Gavel button calls, since the popover it used to open no
     * longer exists. */
    expandAndReveal: () => void;
}

export interface GiurisprudenzaSectionProps {
    articleLabel: string;
    norma: ReferenceNorma;
    /** Straight from `brocardi_info.Massime` — arrives with the article
     * payload, so this card renders immediately, before the section is even
     * expanded. This is what keeps the block from ever being empty on
     * arrival. */
    massime: (string | MassimaStructured)[] | null;
}

/**
 * Inline case-law section for the article currently on screen — a sibling of
 * the Brocardi block, not a floating popover (that design, `CaseLawPanel`,
 * was retired: a 380px popover is the wrong container for up to 20 decision
 * cards, and it kept case law visually apart from Brocardi's own case law,
 * the Massime).
 *
 * Expanded by default the moment there are Massime to show — they rode in on
 * the article payload at zero network cost, so hiding them behind a click
 * would be a regression in access for content that already arrived. The four
 * live court sources are a different concern: they cost seven requests to
 * four government websites, so they never fetch on expand — only when the
 * reader presses the explicit "search the four courts" action below, and the
 * answer then stays cached for the session via `fetchCaseLawCached` — this is
 * content, but it is not user-owned data, so nothing here is persisted.
 */
export const GiurisprudenzaSection = forwardRef<GiurisprudenzaSectionHandle, GiurisprudenzaSectionProps>(
    function GiurisprudenzaSection({ articleLabel, norma, massime }, ref) {
        const massimeCount = massime?.length ?? 0;
        const [isOpen, setIsOpen] = useState(() => massimeCount > 0);
        const rootRef = useRef<HTMLDivElement>(null);

        const riferimento = useMemo(
            () => buildCaseLawReference(norma),
            // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the primitive fields the reference is built from, not `norma`'s identity
            [norma.tipo_atto, norma.numero_atto, norma.data, norma.numero_articolo],
        );
        // Some act types (regio decreto — see `isUnsearchableActType`) have no
        // reference this API can search: courts cite them by a popular name
        // this API has no field for. Skipping the fetch entirely, rather than
        // sending a reference nobody will match, is what keeps the block from
        // asserting four unverified absences.
        const unsearchable = useMemo(() => isUnsearchableActType(norma.tipo_atto), [norma.tipo_atto]);

        type FetchStatus = 'idle' | 'loading' | 'success' | 'error';
        const [status, setStatus] = useState<FetchStatus>('idle');
        const [fonti, setFonti] = useState<SourceResult[]>([]);
        const [errorMessage, setErrorMessage] = useState<string | null>(null);
        const triedRef = useRef(false);
        const requestIdRef = useRef(0);

        // A new article (same tab, cross-reference jump) resets everything —
        // the previous article's decisions must not linger under the new one's
        // header, and the default-open state re-derives from the new
        // article's own Massime rather than carrying over whatever the
        // previous article left the toggle at.
        useEffect(() => {
            triedRef.current = false;
            requestIdRef.current += 1;
            setStatus('idle');
            setFonti([]);
            setErrorMessage(null);
            setIsOpen(massimeCount > 0);
            // `massimeCount > 0` (not `massimeCount`) is the real dependency:
            // Brocardi info can arrive after this component has already
            // mounted with `massime={null}`, and that later transition to
            // "there are Massime now" must still open the section — but a
            // count that merely grows from 3 to 4 Massime on the same
            // article must not re-open a section the reader just collapsed.
            // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above: intentionally keyed on the boolean, not massimeCount itself
        }, [riferimento, massimeCount > 0]);

        const runFetch = useCallback(async () => {
            const id = ++requestIdRef.current;
            setStatus('loading');
            setErrorMessage(null);
            try {
                const res = await fetchCaseLawCached({ riferimento, limite: RESULTS_PER_SOURCE });
                if (requestIdRef.current !== id) return; // a newer article/retry superseded this one
                setFonti(res.fonti);
                setStatus('success');
            } catch (err) {
                if (requestIdRef.current !== id) return;
                // A whole-request failure (the fan-out never ran) — never
                // swallowed into an empty list, which would read as "no case
                // law" for every source at once instead of "the service didn't
                // answer". The raw error is logged for diagnosis, never shown:
                // the UI is Italian throughout, and a lawyer gets no use out of
                // an HTTP status text.
                console.error('GiurisprudenzaSection: /fetch_case_law failed', { riferimento, err });
                setErrorMessage(friendlyErrorMessage(err));
                setStatus('error');
            }
        }, [riferimento]);

        // Fetch the four live sources only on this explicit action — never on
        // mount, never on expand, never on every reopen (fetchCaseLawCached
        // covers a reopen for free, but there is no reason to even call it
        // again; `triedRef` guards a caller pressing the action twice before
        // the first answer lands).
        const handleSearchCourts = useCallback(() => {
            if (triedRef.current) return;
            triedRef.current = true;
            void runFetch();
        }, [runFetch]);

        useImperativeHandle(ref, () => ({
            expandAndReveal() {
                setIsOpen(true);
                // Double rAF: first frame lets React commit the expand, second
                // lets the browser lay out the now-visible content before we
                // scroll to it — same pattern as the Cmd+F search-navigation
                // effect in ArticleTabContent.
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }));
            },
        }), []);

        const courtsCount = status === 'success'
            ? fonti.reduce((sum, f) => sum + f.decisioni.length, 0)
            : 0;
        const totalCount = massimeCount + courtsCount;

        return (
            <div
                ref={rootRef}
                className="giurisprudenza-section bg-slate-50/50 dark:bg-slate-800/30 rounded-xl p-4 sm:p-5 border border-slate-100 dark:border-slate-800"
            >
                <button
                    onClick={() => setIsOpen((v) => !v)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Comprimi' : 'Espandi'} Giurisprudenza — ${articleLabel}, ${totalCount} ${totalCount === 1 ? 'decisione' : 'decisioni'}`}
                    className="w-full flex items-center justify-between text-primary-700 dark:text-primary-400 font-bold uppercase tracking-wider text-xs hover:opacity-80 transition-opacity"
                >
                    <span className="flex items-center gap-2">
                        <Gavel size={18} className="text-primary-500" />
                        Giurisprudenza
                    </span>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-medium normal-case bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                            {totalCount} {totalCount === 1 ? 'decisione' : 'decisioni'}
                        </span>
                        <ChevronDown
                            size={16}
                            className={cn('transition-transform duration-200', isOpen && 'rotate-180')}
                        />
                    </div>
                </button>

                {isOpen && (
                    <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-300">
                        {massimeCount > 0 && (
                            <MassimeSection massime={massime} />
                        )}

                        {unsearchable && <UnsearchableActNotice tipoAtto={norma.tipo_atto} />}

                        {!unsearchable && status === 'idle' && (
                            <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl flex flex-col items-center gap-2 py-6 text-center px-4">
                                <Search size={20} className="text-slate-400 dark:text-slate-500" />
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    Cerca le decisioni di Cassazione, Giustizia amministrativa,
                                    CeRDEF e CGUE che citano questo articolo.
                                </p>
                                <button
                                    onClick={handleSearchCourts}
                                    className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 px-3 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors md:min-h-0 md:py-1.5"
                                >
                                    <Search size={12} /> Cerca nei quattro tribunali
                                </button>
                            </div>
                        )}

                        {!unsearchable && status === 'loading' && (
                            <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl p-4">
                                <SkeletonText lines={4} />
                            </div>
                        )}

                        {!unsearchable && status === 'error' && (
                            <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl flex flex-col items-center gap-2 py-6 text-center">
                                <CircleAlert size={20} className="text-rose-500" />
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    Impossibile contattare il servizio giurisprudenza.
                                </p>
                                {errorMessage && (
                                    <p className="text-xs text-slate-400 dark:text-slate-500">{errorMessage}</p>
                                )}
                                <button
                                    onClick={() => { void runFetch(); }}
                                    className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 px-3 text-xs font-medium rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors md:min-h-0 md:py-1.5"
                                >
                                    <RotateCw size={12} /> Riprova
                                </button>
                            </div>
                        )}

                        {!unsearchable && status === 'success' && fonti.length === 0 && massimeCount === 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                                Nessuna fonte disponibile.
                            </p>
                        )}

                        {!unsearchable && status === 'success' && fonti.map((fonte) => (
                            <SourceCard key={fonte.fonte || fonte.organo} fonte={fonte} />
                        ))}
                    </div>
                )}
            </div>
        );
    },
);

// ───────────────────────── SUBCOMPONENTS ─────────────────────────

/**
 * Replaces the four-source fetch for an act this API cannot build a
 * searchable reference for (`isUnsearchableActType`) — today, `regio
 * decreto` (the legge fallimentare, il T.U.L.P.S.). Four sections saying
 * "Nessuna decisione trovata." would assert an absence nobody verified;
 * this says the true reason instead.
 */
function UnsearchableActNotice({ tipoAtto }: { tipoAtto: string }) {
    return (
        <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl flex flex-col items-center gap-2 py-6 text-center px-4">
            <CircleAlert size={20} className="text-slate-400 dark:text-slate-500" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
                I tribunali citano questo atto ({tipoAtto}) con un nome proprio
                (es. &ldquo;legge fallimentare&rdquo;), non ricavabile dal solo
                tipo e numero.
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
                La ricerca in giurisprudenza non può essere eseguita per questo atto.
            </p>
        </div>
    );
}

/** One source's card — same chrome as `BrocardiSectionContent`: white card,
 * collapsible header with a chevron, `divide-y` row list whose rows are
 * `p-4 hover:bg-slate-50/50`. */
function SourceCard({ fonte }: { fonte: SourceResult }) {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl overflow-hidden transition-all hover:shadow-md">
            <button
                onClick={() => setIsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left gap-2"
            >
                <span className="min-w-0">
                    <strong className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase flex items-center gap-2">
                        {fonte.organo}
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            {fonte.count}
                        </span>
                        {/* An unreachable source must never look like an empty
                            one (CLAUDE.md gotcha 18): the badge, the copy
                            below and the colour are all distinct from the
                            "nothing found" state. */}
                        {!fonte.ok && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                                <WifiOff size={10} /> Non raggiungibile
                            </span>
                        )}
                    </strong>
                    {/* Always visible when the source declares one — a
                        rolling-window source (Cassazione: "ultimi 5 anni")
                        reporting zero results means "nothing in that window",
                        not "nothing exists". */}
                    {fonte.coverage && (
                        <span className="block mt-0.5 text-[11px] text-slate-400 dark:text-slate-500 italic normal-case font-normal">
                            Copertura: {fonte.coverage}
                        </span>
                    )}
                </span>
                <ChevronDown
                    size={16}
                    className={cn('text-slate-400 transition-transform duration-200 shrink-0', isOpen && 'rotate-180')}
                />
            </button>

            {isOpen && (
                <>
                    {!fonte.ok && (
                        <p className="p-4 text-xs text-rose-600 dark:text-rose-400">
                            {fonte.error || 'La fonte non ha risposto.'}
                        </p>
                    )}

                    {fonte.ok && fonte.decisioni.length === 0 && (
                        <p className="p-4 text-xs text-slate-500 dark:text-slate-400 italic">
                            Nessuna decisione trovata.
                        </p>
                    )}

                    {fonte.ok && fonte.decisioni.length > 0 && (
                        <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                            {fonte.decisioni.map((decisione, i) => (
                                <div
                                    key={`${decisione.fonte}-${decisione.numero}-${decisione.anno}-${i}`}
                                    className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                                >
                                    <DecisionRow decisione={decisione} />
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function DecisionRow({ decisione }: { decisione: Decisione }) {
    const deposito = formatDecisioneData(decisione.data ?? '');

    return (
        <div className="text-sm space-y-1">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {decisione.organo} n. {decisione.numero}/{decisione.anno}
                    {decisione.sezione && (
                        <span className="text-slate-400 dark:text-slate-500 font-normal"> &middot; sez. {decisione.sezione}</span>
                    )}
                </span>
                <LinkKindBadge kind={decisione.link_kind} />
            </div>

            {(deposito || decisione.ecli) && (
                <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500 dark:text-slate-400">
                    {deposito && <span>Deposito: {deposito}</span>}
                    {decisione.ecli && <span className="font-mono">{decisione.ecli}</span>}
                </div>
            )}

            {decisione.estratto && (
                <p className="text-[11px] italic text-slate-500 dark:text-slate-400 line-clamp-3">
                    &ldquo;{decisione.estratto}&rdquo;
                </p>
            )}

            <a
                href={decisione.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
                <ExternalLink size={11} /> Apri la fonte
            </a>
        </div>
    );
}

// ───────────────────────── HELPERS ─────────────────────────

/** Normalises the raw `data` a case-law source emits into something
 * `formatDateItalianLong` can render — never the raw string (CLAUDE.md's Date
 * System: every displayed date goes through `formatDateItalianLong`, never a
 * literal). The four adapters agree on nothing:
 * - Italgiure's `datdep` is `YYYYMMDD`, no separators (measured: "20250702").
 * - CeRDEF's row regex captures `DD/MM/YYYY` (measured: "25/08/2020").
 * - Giustizia amministrativa and CGUE never set `data` at all — it defaults
 *   to `""` in `Decisione` (see `visualex_api/services/case_law/base.py`).
 *
 * An absent or unparseable value returns `''`, which callers render as
 * nothing at all rather than "Invalid Date" or a raw, unlocalised string —
 * `formatDateItalianLong` itself just echoes back anything it doesn't
 * recognise, so the two safe shapes (year-only, full ISO date) are checked
 * explicitly before handing it over. */
function formatDecisioneData(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    let iso = trimmed;

    const compact = trimmed.match(/^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/);
    if (compact) {
        iso = `${compact[1]}-${compact[2]}-${compact[3]}`;
    } else {
        const slashed = trimmed.match(/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(\d{4})$/);
        if (slashed) {
            iso = `${slashed[3]}-${slashed[2]}-${slashed[1]}`;
        } else {
            // Already ISO, or a shape none of the adapters are known to send
            // (defensive) — `parseItalianDate` covers a few more inputs, and
            // anything it doesn't recognise it just echoes back, which the
            // guard below catches.
            iso = parseItalianDate(trimmed);
        }
    }

    // Only a bare year or a full YYYY-MM-DD is safe to hand to
    // `formatDateItalianLong` — anything else falls through unformatted
    // there, which would otherwise leak a raw string to the reader.
    if (!/^\d{4}$/.test(iso) && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    return formatDateItalianLong(iso);
}

/** Italian, useful text for the error banner — never the raw error (which the
 * caller already logs). `LegalApiError` carries the HTTP status, so the one
 * case worth telling apart is rate-limiting, which has an actionable answer
 * ("wait"); everything else collapses into one honest "didn't answer". */
function friendlyErrorMessage(err: unknown): string {
    if (err instanceof LegalApiError && err.status === 429) {
        return 'Troppe richieste in questo momento: riprova tra qualche secondo.';
    }
    return 'Il servizio di giurisprudenza non ha risposto correttamente. Riprova.';
}
