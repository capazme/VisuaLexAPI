import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { READER_SLOT_ATTR } from '../../../utils/selectionOffset';
import { ReaderSpace } from './ReaderSpace';

export interface BlockSpaceProps<T extends string | number> {
  /** What the space is about (a block's index); null, closed. Kept while the space closes, so the closing shows it. */
  value: T | null;
  /** The reader's text root, where the blocks are. */
  rootRef: RefObject<HTMLElement | null>;
  /** The block the space opens under. Looked up again each time: `SafeHTML` replaces every node on a redraw. */
  block: (root: HTMLElement, value: T) => HTMLElement | null;
  /** What opened it, for the focus on closing (a block's sign); gone, or none, the block itself takes it. */
  trigger?: (root: HTMLElement, value: T) => HTMLElement | null;
  onClose: () => void;
  title: (value: T) => ReactNode;
  line?: (value: T) => ReactNode;
  icon?: ReactNode;
  children: (value: T) => ReactNode;
}

/**
 * The text's own place for a space (LC142, L-73): one element after the block the action came from, inside the text,
 * with a `ReaderSpace` portalled into it. It opens in the flow and pushes the following text down (`Expand`). One at a
 * time in a text: opening, it closes any other open there (a block's annotations, the selection's actions). The element is the page's, not the article's: `READER_SLOT_ATTR` keeps it out of the
 * stored offsets, the find and the copy (`selectionOffset.ts`). A redraw of the text takes it away with every node: it is
 * put back after the block, and the focus it held with it. On closing the focus goes back to what opened it, or to the
 * block when that is gone (the block's last annotation took its sign with it, or a selection opened it).
 */
export function BlockSpace<T extends string | number>({ value, rootRef, block, trigger, onClose, title, line, icon, children }: BlockSpaceProps<T>) {
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.setAttribute(READER_SLOT_ATTR, '');
    // The text's serif, measure figures and size are the article's: the space speaks the app's.
    el.className = 'font-sans text-base leading-normal text-slate-900 [font-variant-numeric:normal] [text-wrap:wrap] dark:text-slate-100';
    return el;
  });
  const [shown, setShown] = useState(value);
  if (value !== null && value !== shown) setShown(value);
  // Open once the element stands after its block (below): `Expand` takes the focus and scrolls on that change.
  const [placed, setPlaced] = useState<T | null>(null);
  const open = value !== null && placed === value;
  const lastFocus = useRef<HTMLElement | null>(null);
  // Where the block was, from the root: found again there when `block` no longer can (its sign gone with the block's
  // last annotation), the text redrawn or not.
  const blockPath = useRef<number[] | null>(null);
  const findBlock = (root: HTMLElement, at: T) => block(root, at) ?? (blockPath.current ? atPath(root, blockPath.current) : null);

  // After every render on purpose: a redraw of the text comes with no prop of this one. Its updates are guarded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const root = rootRef.current;
    // Closed, it is not put back: a redraw takes it out of the text.
    const target = root && shown !== null && (value !== null || placed !== null) ? findBlock(root, shown) : null;
    if (root && target) blockPath.current = pathOf(root, target);
    if (target && host.previousElementSibling !== target) {
      const lost = !host.isConnected;
      target.after(host);
      // A redraw dropped the focus with the old element: it comes back where it was.
      const active = document.activeElement;
      if (lost && (active === document.body || active === null) && lastFocus.current && host.contains(lastFocus.current)) lastFocus.current.focus({ preventScroll: true });
    }
    if (value !== null && placed !== value && host.isConnected) setPlaced(value);
    if (value === null && placed !== null) setPlaced(null);
  });

  // Gone with its reader (a reader that stops asking for a selection's actions), it leaves the text.
  useEffect(() => () => host.remove(), [host]);

  // One at a time: an opening says so, and the others open in the same text close.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return undefined;
    document.dispatchEvent(new CustomEvent(SPACE_OPENED, { detail: host }));
    const onOther = (event: Event) => {
      const other = (event as CustomEvent<HTMLElement>).detail;
      if (other !== host && rootRef.current?.contains(other)) closeRef.current();
    };
    document.addEventListener(SPACE_OPENED, onOther);
    return () => document.removeEventListener(SPACE_OPENED, onOther);
  }, [open, rootRef, host]);

  // Closed, the focus goes back to the sign looked up again, or the block (`FocusBack`).
  const focusTarget = () => {
    const root = rootRef.current;
    return root && shown !== null ? trigger?.(root, shown) ?? findBlock(root, shown) : null;
  };

  return createPortal(
    <div onFocus={(event) => { lastFocus.current = event.target as HTMLElement; }}>
      <FocusBack open={open} host={host} target={focusTarget} />
      <ReaderSpace open={open} onClose={onClose} title={shown === null ? '' : title(shown)} line={shown === null ? undefined : line?.(shown)} icon={icon}>
        {shown !== null && <Fragment key={shown}>{children(shown)}</Fragment>}
      </ReaderSpace>
    </div>,
    host,
  );
}

const SPACE_OPENED = 'vlx-space-opened';

/**
 * On closing, the focus left in the space (or dropped to the page with it) goes to `target`. Drawn before the space, so
 * its effect runs before `Expand`'s, which would give it to whatever held it at the opening: a selection has no opener,
 * and a sign is redrawn.
 */
function FocusBack({ open, host, target }: { open: boolean; host: HTMLElement; target: () => HTMLElement | null }) {
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    const active = document.activeElement;
    if (open || !(active === document.body || active === null || host.contains(active))) return;
    const to = target();
    if (!to) return;
    if (!to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
    to.focus({ preventScroll: true });
    // `target` reads the props of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host]);
  return null;
}

/** The element children, a space's own element apart: its place in the text is not the text's. */
const kids = (el: Element) => Array.from(el.children).filter((c) => !c.hasAttribute(READER_SLOT_ATTR));

function pathOf(root: HTMLElement, el: Element): number[] | null {
  const path: number[] = [];
  for (let at: Element = el; at !== root; at = at.parentElement!) {
    if (!at.parentElement) return null;
    path.unshift(kids(at.parentElement).indexOf(at));
  }
  return path;
}

function atPath(root: HTMLElement, path: number[]): HTMLElement | null {
  let at: Element | undefined = root;
  for (const i of path) at = at && kids(at)[i];
  return at instanceof HTMLElement ? at : null;
}
