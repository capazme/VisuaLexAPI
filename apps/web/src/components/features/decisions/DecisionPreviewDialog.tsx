/**
 * The preview a list opens on a decision (spec 2026-10-13-decision-preview-from-lists-design): a click
 * or a key on its estremi shows the hover preview's body (`DecisionPreviewContent`) at once, with the
 * way to open it beside. On the desktop it is the hover popup's frame as a non-modal dialog under the
 * estremi, holding the focus; on a phone a bottom sheet.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { ExternalLink } from 'lucide-react';
import { useDecisionPreview } from '../../../hooks/useDecisionPreview';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import { DecisionPreviewContent } from '../../ui/DecisionPreviewPopup';
import { PreviewFrame } from '../../ui/PreviewFrame';
import { Sheet } from '../../ui/Sheet';

type Preview = ReturnType<typeof useDecisionPreview>;

interface DecisionPreviewDialogProps {
  preview: Preview;
  /** The estremi the preview was opened from: it sits under them, and the focus goes back to them. */
  anchorRef: RefObject<HTMLElement | null>;
  /** What «Apri accanto» does: the row's own way of opening the decision. */
  onOpen: () => void;
  /** «Apri accanto» on the search page, «Apri la sentenza» where the decision opens in a practice elsewhere. */
  openLabel: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DecisionPreviewDialog({ preview, anchorRef, onOpen, openLabel }: DecisionPreviewDialogProps) {
  const desktop = useIsDesktop();
  const frameRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  // «Apri accanto» hands the focus to the decision opened: the estremi do not take it back
  const returnFocus = useRef(true);
  const height = useRef<number | undefined>(undefined);
  const { isVisible, isLoading, error, reference, answer, position, hidePreview, followAnchor } = preview;
  const label = reference ? `Anteprima di ${formatDecisionShort(reference)}` : 'Anteprima della decisione';

  const handleOpen = useCallback(() => {
    returnFocus.current = false;
    hidePreview();
    onOpen();
  }, [hidePreview, onOpen]);

  useEffect(() => {
    if (!desktop || !isVisible) return;
    const anchor = anchorRef.current;
    returnFocus.current = true;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (frameRef.current?.contains(target) || anchor?.contains(target)) return;
      hidePreview();
    };
    // the list scrolled (or the window changed size): the preview stays by its estremi
    const onMove = (e: Event) => {
      if (e.target instanceof Node && frameRef.current?.contains(e.target)) return;
      if (anchor) followAnchor(anchor, height.current);
    };
    // its real height (the answer arrived, the text is longer): it stays inside the window
    const measure = () => {
      const frame = frameRef.current;
      if (!frame || !anchor) return;
      height.current = frame.offsetHeight;
      followAnchor(anchor, height.current);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    // after the frame has mounted (it is portalled and animated in); the observer measures it at once
    const focusTimer = window.setTimeout(() => {
      openRef.current?.focus();
      if (frameRef.current) resize?.observe(frameRef.current);
    }, 0);
    // Tab cycles inside the preview, as in any dialog; Esc is the frame's
    const onKeyDown = (e: KeyboardEvent) => {
      const frame = frameRef.current;
      if (e.key !== 'Tab' || !frame) return;
      const focusable = Array.from(frame.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey ? active === first || !frame.contains(active) : active === last || !frame.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      resize?.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('keydown', onKeyDown);
      // back to the estremi, unless the reader put the focus somewhere else meanwhile (the preview is
      // unmounted when it closes, so a focus that was inside it is now on the body)
      const active = document.activeElement;
      if (returnFocus.current && (!active || active === document.body) && anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [desktop, isVisible, anchorRef, hidePreview, followAnchor]);

  const openButton = (
    <button
      ref={openRef}
      type="button"
      onClick={handleOpen}
      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 md:min-h-0"
    >
      <ExternalLink size={14} aria-hidden />
      {openLabel}
    </button>
  );
  const content = <DecisionPreviewContent isLoading={isLoading} error={error} reference={reference} answer={answer} />;

  if (!isVisible || !reference) return null;
  if (!desktop) {
    return (
      <Sheet title={formatDecisionShort(reference)} onClose={hidePreview} initialFocusRef={openRef} closeOnEscape closeOnBackdrop>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{content}</div>
        <div className="shrink-0 border-t border-slate-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800">{openButton}</div>
      </Sheet>
    );
  }
  return (
    <PreviewFrame
      visible
      position={position}
      title={formatDecisionShort(reference)}
      onClose={hidePreview}
      footer={openButton}
      dialog={{ label, frameRef }}
    >
      {content}
    </PreviewFrame>
  );
}
