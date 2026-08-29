import { useEffect, useMemo, useRef, useState } from 'react';
import {
    useFloating,
    useDismiss,
    useRole,
    useInteractions,
    FloatingPortal,
    FloatingFocusManager,
    autoUpdate,
    flip,
    offset,
    shift,
    size,
} from '@floating-ui/react';
import { Gavel, X, BadgeCheck, SearchCheck, WifiOff, CircleAlert, ExternalLink, RotateCw } from 'lucide-react';
import type { Decisione, LinkKind, NormaVisitata, SourceResult } from '../../../types';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { SkeletonText } from '../../ui/Skeleton';
import { buildCaseLawReference, fetchCaseLaw, isUnsearchableActType } from '../../../services/caseLawService';
import { LegalApiError } from '../../../services/legalApi';

// Per-source cap on a fan-out to four sources rendered in a single 380px
// popover — the backend default (10/source, up to 40 cards) is what made the
// panel grow past its own bounds in the first place. 5 keeps a source with
// hits readable without scrolling through a wall of cards, while the panel's
// own internal scroll (see PeekBody) still covers a source with more.
const RESULTS_PER_SOURCE = 5;

type ReferenceNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo'>;

export interface CaseLawPanelProps {
    isOpen: boolean;
    anchorEl: HTMLElement | null;
    articleLabel: string;
    norma: ReferenceNorma;
    onClose: () => void;
}

/**
 * Case-law panel for the article currently on screen — owner priority (a).
 * Fetches live from `/fetch_case_law` on open (and again if the article
 * changes while the panel stays open); nothing is cached or persisted, per
 * CLAUDE.md: this is not user-owned data.
 *
 * Desktop-only floating popover: its trigger (`ReadingToolbar`'s Gavel
 * button) lives in the toolbar's `hidden md:flex` row, same as the Notes and
 * Highlights triggers it was modelled on — none of the three has a mobile
 * entry point today. A NotesPeekPanel-style mobile bottom sheet was tried
 * here and removed: with no way to open it, it was UI no user could ever
 * reach (CLAUDE.md's "shipping UI no user can open" is exactly this shape).
 * If a mobile entry point is added for any of the three, add it for all
 * three together, not just this one.
 */
export function CaseLawPanel(props: CaseLawPanelProps) {
    if (!props.isOpen) return null;
    return <DesktopPeek {...props} />;
}

type BodyProps = Omit<CaseLawPanelProps, 'anchorEl'>;

// ───────────────────────── DESKTOP POPOVER ─────────────────────────

function DesktopPeek({ anchorEl, onClose, ...rest }: CaseLawPanelProps) {
    // The `size()` middleware only ever hands a computed value to
    // `elements.floating` — the OUTER div below, positioned by floating-ui.
    // That div isn't the flex column that holds the scrollable body, so a
    // max-height set there just lets the inner card grow past it instead of
    // capping anything: `overflow: visible` (the default) paints the
    // overflow outside the box rather than clipping or scrolling it. Routing
    // the computed value through this ref, onto the INNER card (the actual
    // `flex flex-col overflow-hidden` container), is what makes the cap and
    // the body's `overflow-y-auto` (see PeekBody) apply to the same box.
    const cardRef = useRef<HTMLDivElement>(null);

    // Anchor passed via `elements.reference` so the first render is already
    // positioned — see NotesPeekPanel for the same reasoning (gotcha 13).
    const { refs, floatingStyles, context, placement } = useFloating({
        open: true,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'bottom-end',
        elements: { reference: anchorEl },
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['top-end', 'bottom', 'top'] }),
            shift({ padding: 16 }),
            // eslint-disable-next-line react-hooks/refs -- `apply()` is invoked by floating-ui's own positioning pass (autoUpdate/ResizeObserver), asynchronously and outside React's render, never synchronously while this component renders — same category as the `refs.setFloating` disable above.
            size({
                apply({ availableHeight }) {
                    if (cardRef.current) {
                        cardRef.current.style.maxHeight =
                            `${Math.max(280, Math.min(520, availableHeight - 16))}px`;
                    }
                },
                padding: 16,
            }),
        ],
        whileElementsMounted: autoUpdate,
    });

    const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    return (
        <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Inner wrapper owns both the entry animation, kept apart
                        from floating-ui's positioning transform on the outer
                        div (see the matching comment in NotesPeekPanel), AND
                        the height cap (see `cardRef` above) — it is the box
                        that actually needs to stop growing. */}
                    <div
                        ref={cardRef}
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'w-[380px] flex flex-col overflow-hidden rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700',
                            'bg-white dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <PeekBody onClose={onClose} {...rest} />
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

// ───────────────────────── SHARED BODY ─────────────────────────

type FetchStatus = 'loading' | 'success' | 'error';

function PeekBody({ articleLabel, norma, onClose }: BodyProps) {
    const riferimento = useMemo(
        () => buildCaseLawReference(norma),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the primitive fields the reference is built from, not `norma`'s identity
        [norma.tipo_atto, norma.numero_atto, norma.data, norma.numero_articolo],
    );
    // Some act types (regio decreto — see `isUnsearchableActType`) have no
    // reference this API can search: courts cite them by a popular name this
    // API has no field for. Skipping the fetch entirely, rather than sending
    // a reference nobody will match, is what keeps the panel from asserting
    // four unverified absences.
    const unsearchable = useMemo(
        () => isUnsearchableActType(norma.tipo_atto),
        [norma.tipo_atto],
    );

    const [status, setStatus] = useState<FetchStatus>('loading');
    const [fonti, setFonti] = useState<SourceResult[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // Bumped by "Riprova" to re-run the fetch below without a riferimento change.
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        if (unsearchable) return;
        let cancelled = false;
        setStatus('loading');
        setErrorMessage(null);
        fetchCaseLaw({ riferimento, limite: RESULTS_PER_SOURCE })
            .then((res) => {
                if (cancelled) return;
                setFonti(res.fonti);
                setStatus('success');
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                // This is a whole-request failure (the fan-out never ran) — never
                // swallowed into an empty list, which would read as "no case law"
                // for every source at once instead of "the service didn't answer".
                // The raw error (e.g. "/fetch_case_law failed: Internal Server
                // Error") is logged for diagnosis, never shown: the UI is Italian
                // throughout, and a lawyer gets no use out of an HTTP status text.
                console.error('CaseLawPanel: /fetch_case_law failed', { riferimento, err });
                setErrorMessage(friendlyErrorMessage(err));
                setStatus('error');
            });
        return () => { cancelled = true; };
    }, [riferimento, retryToken, unsearchable]);

    return (
        <>
            <header className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                    <Gavel size={16} className="text-indigo-500 shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        Giurisprudenza &mdash; {articleLabel}
                    </h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    title="Chiudi (Esc)"
                    aria-label="Chiudi pannello giurisprudenza"
                >
                    <X size={16} />
                </button>
            </header>

            {/* `min-h-0` overrides the flex item's default `min-height: auto`
                (a well-known flexbox trap): without it, this box refuses to
                shrink below its content's natural height even though it sits
                in a `flex flex-col` parent with `overflow-hidden` and a
                max-height, so it grows the whole card instead of scrolling
                internally. */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
                {unsearchable && <UnsearchableActNotice tipoAtto={norma.tipo_atto} />}

                {!unsearchable && status === 'loading' && <SkeletonText lines={4} />}

                {!unsearchable && status === 'error' && (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                        <CircleAlert size={20} className="text-rose-500" />
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            Impossibile contattare il servizio giurisprudenza.
                        </p>
                        {errorMessage && (
                            <p className="text-xs text-slate-400 dark:text-slate-500">{errorMessage}</p>
                        )}
                        <button
                            onClick={() => setRetryToken((n) => n + 1)}
                            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                        >
                            <RotateCw size={12} /> Riprova
                        </button>
                    </div>
                )}

                {!unsearchable && status === 'success' && fonti.length === 0 && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                        Nessuna fonte disponibile.
                    </p>
                )}

                {!unsearchable && status === 'success' && fonti.map((fonte) => (
                    <SourceSection key={fonte.fonte || fonte.organo} fonte={fonte} />
                ))}
            </div>
        </>
    );
}

// ───────────────────────── SUBCOMPONENTS ─────────────────────────

/**
 * Replaces the four-source fetch for an act this API cannot build a
 * searchable reference for (`isUnsearchableActType`) — today, `regio
 * decreto` (the legge fallimentare, il T.U.L.P.S.). Four sections saying
 * "Nessuna decisione trovata." would assert an absence nobody verified;
 * this says the true reason instead, in the same italic, muted register the
 * per-source empty state already uses elsewhere in this panel.
 */
function UnsearchableActNotice({ tipoAtto }: { tipoAtto: string }) {
    return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
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

function SourceSection({ fonte }: { fonte: SourceResult }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {fonte.organo}
                </h4>
                {/* An unreachable source must never look like an empty one
                    (CLAUDE.md gotcha 18): the badge, the copy below and the
                    colour are all distinct from the "nothing found" state. */}
                {!fonte.ok && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 shrink-0">
                        <WifiOff size={10} /> Non raggiungibile
                    </span>
                )}
            </div>

            {/* Always visible when the source declares one — a rolling-window
                source (Cassazione: "ultimi 5 anni") reporting zero results
                means "nothing in that window", not "nothing exists". */}
            {fonte.coverage && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                    Copertura: {fonte.coverage}
                </p>
            )}

            {!fonte.ok && (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                    {fonte.error || 'La fonte non ha risposto.'}
                </p>
            )}

            {fonte.ok && fonte.decisioni.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                    Nessuna decisione trovata.
                </p>
            )}

            {fonte.ok && fonte.decisioni.length > 0 && (
                <div className="space-y-2">
                    {fonte.decisioni.map((decisione, i) => (
                        <DecisionRow
                            key={`${decisione.fonte}-${decisione.numero}-${decisione.anno}-${i}`}
                            decisione={decisione}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// The one distinction the whole panel exists to preserve: a source-declared
// fact ("cited") vs. a search engine's inference ("matched"). Colour, icon
// AND label all differ, so the difference survives a glance, a screenshot,
// or a colourblind reader — never just a hover title.
const LINK_KIND_CONFIG: Record<LinkKind, {
    label: string;
    icon: typeof BadgeCheck;
    containerClass: string;
    title: string;
}> = {
    cited: {
        label: 'Citazione dichiarata',
        icon: BadgeCheck,
        containerClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        title: 'La fonte dichiara che questa decisione cita la norma: un fatto, non un’inferenza.',
    },
    matched: {
        label: 'Trovata nel testo',
        icon: SearchCheck,
        containerClass: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        title: 'Il testo della norma è stato trovato nella decisione: un’inferenza della ricerca, può essere sbagliata (es. lo stesso articolo di un altro codice).',
    },
};

function LinkKindBadge({ kind }: { kind: LinkKind }) {
    // A `kind` this map has no entry for must never fall back to `cited`:
    // that badge claims the source *declared* the citation, which would turn
    // an unrecognised value into a fabricated fact instead of the inference
    // `matched` already, correctly, admits it might be wrong. It must also
    // not throw — this renders inside a `FloatingPortal` with no error
    // boundary above it, so an unguarded lookup would take the whole reading
    // surface down over one bad badge.
    const config = LINK_KIND_CONFIG[kind] ?? LINK_KIND_CONFIG.matched;
    const Icon = config.icon;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0',
                config.containerClass,
            )}
            title={config.title}
        >
            <Icon size={10} />
            {config.label}
        </span>
    );
}

function DecisionRow({ decisione }: { decisione: Decisione }) {
    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm space-y-1">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {decisione.organo} n. {decisione.numero}/{decisione.anno}
                    {decisione.sezione && (
                        <span className="text-slate-400 dark:text-slate-500 font-normal"> &middot; sez. {decisione.sezione}</span>
                    )}
                </span>
                <LinkKindBadge kind={decisione.link_kind} />
            </div>

            {(decisione.data || decisione.ecli) && (
                <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500 dark:text-slate-400">
                    {decisione.data && <span>Deposito: {decisione.data}</span>}
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

/** Same helper as NotesPeekPanel/HighlightsActionsPicker — not shared between
 * them either, so this keeps the existing (non-)convention rather than
 * inventing a new shared module for three call sites. */
function getTransformOrigin(placement: string): string {
    const [side, align] = placement.split('-') as [string, string | undefined];
    const opposite: Record<string, string> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
    const main = opposite[side] ?? 'center';
    const crossAxisIsHorizontal = side === 'top' || side === 'bottom';
    const cross = !align
        ? 'center'
        : crossAxisIsHorizontal
            ? (align === 'start' ? 'left' : 'right')
            : (align === 'start' ? 'top' : 'bottom');
    return crossAxisIsHorizontal ? `${cross} ${main}` : `${main} ${cross}`;
}
