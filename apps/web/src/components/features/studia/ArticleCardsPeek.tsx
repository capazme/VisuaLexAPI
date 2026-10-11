import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { getTransformOrigin } from '../../../utils/floatingOrigin';
import type { SchedaDellArticolo } from '../../../types/studia';
import { StateChip } from './StateChip';

export interface ArticleCardsPeekProps {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  cards: SchedaDellArticolo[];
  /** The article in words («art. 1453 c.c.»), for the header. */
  articleLabel: string;
  onClose: () => void;
}

/**
 * The cards on an article, as the notes' Peek lists the notes: a header, a scrollable list, no
 * composer. A popover beside the row on a desktop, a bottom sheet on a phone. The reader's own card
 * opens in «Le mie schede»; a community card is not theirs to open there (the card's address answers
 * only its author), so its row opens in place and shows the answer and the explanation the list
 * already carries.
 */
export function ArticleCardsPeek({ isOpen, anchorEl, ...body }: ArticleCardsPeekProps) {
  const desktop = useIsDesktop();
  if (!isOpen) return null;
  return desktop ? <DesktopPeek anchorEl={anchorEl} {...body} /> : <MobileSheet {...body} />;
}

function DesktopPeek({ anchorEl, onClose, ...rest }: Omit<ArticleCardsPeekProps, 'isOpen'>) {
  // The anchor goes in at render, so the first paint is already placed (gotcha 13).
  const { refs, floatingStyles, context, placement } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement: 'bottom-start',
    elements: { reference: anchorEl },
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['top-start', 'bottom', 'top'] }),
      shift({ padding: 16 }),
      size({
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(240, Math.min(480, availableHeight - 16))}px`,
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
          aria-label="Schede su questo articolo"
          className={Z_INDEX.citationPreview}
        >
          {/* The inner box owns the entry animation: on the positioned element it would overwrite the placement. */}
          <div
            style={{ transformOrigin: getTransformOrigin(placement) }}
            className={cn(
              'flex max-h-[inherit] w-[360px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
              'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-150',
            )}
          >
            <PeekBody onClose={onClose} {...rest} />
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}

function MobileSheet({ onClose, ...rest }: Omit<ArticleCardsPeekProps, 'isOpen' | 'anchorEl'>) {
  // Esc closes it too (an external keyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <FloatingPortal>
      <div className={cn('fixed inset-0 bg-slate-900/30 motion-safe:animate-in motion-safe:fade-in duration-150', Z_INDEX.citationPreview)} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Schede su questo articolo"
        className={cn(
          'fixed inset-x-0 bottom-0 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
          'motion-safe:animate-in motion-safe:slide-in-from-bottom duration-200',
          Z_INDEX.citationPreview,
        )}
      >
        <div className="flex justify-center pb-1 pt-2">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        <PeekBody onClose={onClose} {...rest} />
      </div>
    </FloatingPortal>
  );
}

const ROW =
  'flex min-h-[44px] w-full items-start justify-between gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-slate-800/60';

function RowBody({ card }: { card: SchedaDellArticolo }) {
  return (
    <>
      <span className="min-w-0 break-words">
        {card.domanda}
        {card.comunita && card.stato === 'VALIDATA' && card.approvazioni !== null && (
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Validata da {card.approvazioni}</span>
        )}
      </span>
      <StateChip stato={card.stato} className="mt-0.5 shrink-0" />
    </>
  );
}

/** A community card: its row opens in place, the answer and the explanation as plain text. */
function CommunityRow({ card }: { card: SchedaDellArticolo }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={open ? detailId : undefined} className={ROW}>
        <Chevron size={16} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
        <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <RowBody card={card} />
        </span>
      </button>
      {open && (
        <div id={detailId} className="space-y-2 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Risposta</p>
            <p className="whitespace-pre-line break-words">{card.risposta}</p>
          </div>
          {card.spiegazione && (
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Spiegazione</p>
              <p className="whitespace-pre-line break-words">{card.spiegazione}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function PeekBody({ cards, articleLabel, onClose }: Pick<ArticleCardsPeekProps, 'cards' | 'articleLabel' | 'onClose'>) {
  return (
    <>
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 py-1 pl-4 pr-1 dark:border-slate-800">
        <h3 className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white">
          Schede su {articleLabel}
          <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">{cards.length}</span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          title="Chiudi (Esc)"
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:min-w-0 md:p-1.5 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {cards.map((card) => (
          <li key={card.id}>
            {card.comunita ? (
              <CommunityRow card={card} />
            ) : (
              <Link to={`/studia/schede/${encodeURIComponent(card.id)}`} onClick={onClose} className={ROW}>
                <RowBody card={card} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
