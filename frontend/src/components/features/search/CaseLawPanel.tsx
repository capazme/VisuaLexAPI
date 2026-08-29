import { useEffect, useMemo, useState } from 'react';
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
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { SkeletonText } from '../../ui/Skeleton';
import { buildCaseLawReference, fetchCaseLaw } from '../../../services/caseLawService';

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
 * Follows NotesPeekPanel's shape: a desktop floating popover / mobile bottom
 * sheet split, both driven by the same body, and the same
 * offset-transform/animation-transform split (gotcha 10) so the entry
 * animation doesn't fight floating-ui's positioning.
 */
export function CaseLawPanel(props: CaseLawPanelProps) {
    const isDesktop = useIsDesktop();
    if (!props.isOpen) return null;
    return isDesktop ? <DesktopPeek {...props} /> : <MobileSheet {...props} />;
}

type BodyProps = Omit<CaseLawPanelProps, 'anchorEl'>;

// ───────────────────────── DESKTOP POPOVER ─────────────────────────

function DesktopPeek({ anchorEl, onClose, ...rest }: CaseLawPanelProps) {
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
            size({
                apply({ availableHeight, elements }) {
                    Object.assign(elements.floating.style, {
                        maxHeight: `${Math.max(280, Math.min(520, availableHeight - 16))}px`,
                    });
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
                    // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Inner wrapper owns the entry animation, kept apart from
                        floating-ui's positioning transform on the outer div —
                        see the matching comment in NotesPeekPanel. */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'w-[380px] flex flex-col rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700',
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

// ───────────────────────── MOBILE BOTTOM SHEET ─────────────────────────

function MobileSheet({ onClose, ...rest }: CaseLawPanelProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <FloatingPortal>
            <div
                className={cn('fixed inset-0 bg-black/30 animate-in fade-in duration-150', Z_INDEX.citationPreview)}
                onClick={onClose}
                aria-hidden
            />
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'fixed inset-x-0 bottom-0 flex flex-col rounded-t-2xl shadow-2xl',
                    'bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800',
                    'max-h-[75vh] animate-in slide-in-from-bottom duration-200',
                    Z_INDEX.citationPreview,
                )}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                </div>
                <PeekBody onClose={onClose} {...rest} />
            </div>
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

    const [status, setStatus] = useState<FetchStatus>('loading');
    const [fonti, setFonti] = useState<SourceResult[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // Bumped by "Riprova" to re-run the fetch below without a riferimento change.
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        setErrorMessage(null);
        fetchCaseLaw({ riferimento })
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
                console.error('CaseLawPanel: /fetch_case_law failed', { riferimento, err });
                setErrorMessage(err instanceof Error ? err.message : 'Errore sconosciuto');
                setStatus('error');
            });
        return () => { cancelled = true; };
    }, [riferimento, retryToken]);

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

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {status === 'loading' && <SkeletonText lines={4} />}

                {status === 'error' && (
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

                {status === 'success' && fonti.length === 0 && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                        Nessuna fonte disponibile.
                    </p>
                )}

                {status === 'success' && fonti.map((fonte) => (
                    <SourceSection key={fonte.fonte || fonte.organo} fonte={fonte} />
                ))}
            </div>
        </>
    );
}

// ───────────────────────── SUBCOMPONENTS ─────────────────────────

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
    const config = LINK_KIND_CONFIG[kind];
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
