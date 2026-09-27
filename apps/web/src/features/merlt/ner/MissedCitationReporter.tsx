import { useLayoutEffect, useMemo } from 'react';
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
  type VirtualElement,
} from '@floating-ui/react';
import { Flag, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { NerReferenceEditor, type NerReference } from './NerReferenceEditor';

export interface MissedCitationReporterProps {
  /** Viewport rect of the selection, captured before the selection was cleared (gotcha 16). */
  anchorRect: { x: number; y: number; width: number; height: number };
  /** The text the user flagged as a legal reference. */
  selectedText: string;
  onSubmit: (reference: NerReference) => void;
  onClose: () => void;
}

/**
 * "Segnala come citazione" (Loop β #2, feedback_type=missed): a small editor
 * anchored on the selection where the user says which norm a reference the
 * detector missed actually cites. Positioned like InlineNoteComposer: the
 * anchor is a virtual element built from the captured rect, registered with
 * `setPositionReference` (floating-ui rejects virtual elements passed as
 * `elements.reference`) and hidden until `isPositioned` (gotcha 13); the outer
 * element carries the positioning transform and the inner one the entry
 * animation (gotcha 10).
 */
export function MissedCitationReporter({ anchorRect, selectedText, onSubmit, onClose }: MissedCitationReporterProps) {
  const virtualReference = useMemo<VirtualElement>(
    () => ({
      getBoundingClientRect: () =>
        ({
          x: anchorRect.x,
          y: anchorRect.y,
          width: anchorRect.width,
          height: anchorRect.height,
          top: anchorRect.y,
          left: anchorRect.x,
          right: anchorRect.x + anchorRect.width,
          bottom: anchorRect.y + anchorRect.height,
          toJSON() {
            return this;
          },
        }) as DOMRect,
    }),
    [anchorRect.x, anchorRect.y, anchorRect.width, anchorRect.height],
  );

  const { refs, floatingStyles, context, placement, isPositioned } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement: 'bottom',
    middleware: [offset(10), flip({ fallbackPlacements: ['top', 'bottom-start', 'top-start'] }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    refs.setPositionReference(virtualReference);
  }, [refs, virtualReference]);

  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const side = placement.split('-')[0];
  const transformOrigin = side === 'top' ? 'center bottom' : 'center top';

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false}>
        <div
          ref={refs.setFloating}
          style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
          aria-label="Segnala come citazione"
          {...getFloatingProps()}
          className={Z_INDEX.citationPreview}
        >
          <div
            style={{ transformOrigin }}
            className={cn(
              'w-[300px] max-w-[calc(100vw-24px)] rounded-lg border border-blue-200 bg-white shadow-xl dark:border-blue-900/60 dark:bg-slate-900',
              'animate-in fade-in zoom-in-95 duration-150',
            )}
          >
            <div className="flex items-start gap-2 px-3 pb-1 pt-2.5">
              <Flag size={14} className="mt-0.5 shrink-0 text-blue-500" aria-hidden="true" />
              <p className="line-clamp-2 min-w-0 flex-1 text-[11px] italic text-slate-600 dark:text-slate-300">
                Citazione non riconosciuta: &ldquo;{selectedText}&rdquo;
              </p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Chiudi"
                className="-m-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:min-w-0 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X size={12} />
              </button>
            </div>
            <div className="px-3 pb-3">
              <NerReferenceEditor
                autoFocus
                heading="Quale norma cita?"
                actTypeLabel="Tipo atto citato"
                articleLabel="Articolo citato"
                onCancel={onClose}
                onSave={onSubmit}
              />
            </div>
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
