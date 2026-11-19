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
import { Button } from '../../ui/Button';
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
    // fixed, not absolute: opened while its passage is still being scrolled to, an absolute popover
    // would sit far down the document and make the page itself scroll (the app's never does)
    strategy: 'fixed',
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
              'w-64 rounded-[8px] border border-teal-200 bg-white p-1.5 shadow-md dark:border-teal-900/60 dark:bg-slate-900',
              'animate-in fade-in zoom-in-95 duration-(--dur-pop)',
            )}
          >
            <div className="px-2.5 pb-1.5 pt-1">
              <p className="text-sm font-semibold text-teal-800 dark:text-teal-300">{label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Evidenziato automaticamente: non è una tua evidenziazione.</p>
            </div>
            <Button variant="quiet" className="w-full justify-start px-2.5" icon={<Highlighter size={16} aria-hidden className="text-amber-500" />} onClick={() => { onMakeOwn(); onClose(); }}>
              Fai tua (evidenzia)
            </Button>
            <Button variant="quiet" className="w-full justify-start px-2.5" icon={<EyeOff size={16} aria-hidden className="text-slate-400" />} onClick={() => { onHideAll(); onClose(); }}>
              Nascondi i passaggi chiave
            </Button>
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
