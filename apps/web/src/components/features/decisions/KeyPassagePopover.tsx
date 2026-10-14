import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { EyeOff, Highlighter } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { getTransformOrigin } from '../../../utils/floatingOrigin';
import type { KeyPassageKind } from '../../../utils/decisionKeyPassages';
import { KEY_PASSAGE_LABELS } from '../../../utils/decisionRender';

export interface KeyPassagePopoverProps {
  kind: KeyPassageKind;
  /** The passage's first piece in the text: the popover sits by it. */
  anchorEl: HTMLElement;
  onMakeOwn: () => void;
  onHideAll: () => void;
  onClose: () => void;
}

const ACTION =
  'flex min-h-[44px] w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * What a key passage is, and what the reader can do with it (spec 2026-10-13-decision-key-passages-design,
 * «What the reader sees» 3): «Fai tua» makes it a highlight of theirs, through the ordinary action;
 * «Nascondi i passaggi chiave» switches them all off. Never a store of its own: a passage is
 * recomputed from the text on every render.
 */
export function KeyPassagePopover({ kind, anchorEl, onMakeOwn, onHideAll, onClose }: KeyPassagePopoverProps) {
  const { refs, floatingStyles, context, placement } = useFloating({
    open: true,
    onOpenChange: (open) => { if (!open) onClose(); },
    placement: 'bottom-start',
    elements: { reference: anchorEl },
    middleware: [offset(8), flip({ fallbackPlacements: ['top-start', 'bottom', 'top'] }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);
  const label = KEY_PASSAGE_LABELS[kind];

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={0}>
        <div
          // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          aria-label={`${label}, evidenziato automaticamente`}
          // a press in it is not a click away from a practice's folded-table overlay
          data-floating-tool
          className={Z_INDEX.citationPreview}
        >
          {/* the entry animation on an inner element, so it does not fight the positioning transform */}
          <div
            style={{ transformOrigin: getTransformOrigin(placement) }}
            className={cn(
              'w-64 rounded-lg border border-teal-200 bg-white p-1.5 shadow-xl dark:border-teal-900/60 dark:bg-slate-900',
              'animate-in fade-in zoom-in-95 duration-150',
            )}
          >
            <div className="px-2.5 pb-1.5 pt-1">
              <p className="text-sm font-semibold text-teal-800 dark:text-teal-300">{label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Evidenziato automaticamente: non è una tua evidenziazione.</p>
            </div>
            <button type="button" className={ACTION} onClick={() => { onMakeOwn(); onClose(); }}>
              <Highlighter size={15} aria-hidden className="shrink-0 text-amber-500" />
              Fai tua (evidenzia)
            </button>
            <button type="button" className={ACTION} onClick={() => { onHideAll(); onClose(); }}>
              <EyeOff size={15} aria-hidden className="shrink-0 text-slate-400" />
              Nascondi i passaggi chiave
            </button>
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
