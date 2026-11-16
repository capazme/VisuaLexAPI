import { useEffect, useState, type CSSProperties } from 'react';
import type { SectionId } from '../../features/sections/sections';

/**
 * The section's scene in the empty bottom right of a short page (Luca 16-11; the consultant's seven rules in «Sfondi
 * delle sezioni»): one engraving per section, a mask in the theme's ink at 6 % (8 % on the dark), still, from lg,
 * decorative. It is drawn only in the room under the page's content, shrunk to it, so it never sits
 * behind text, a card or a button; Learn's «Oggi», already full, has none.
 */
const PLATES: Record<SectionId, { file: string; width: number; ratio: number; fadeRight: boolean }> = {
  opus: { file: 'sfondo-work', width: 360, ratio: 306 / 390, fadeRight: true },
  gymnasium: { file: 'sfondo-learn', width: 560, ratio: 308 / 649, fadeRight: true },
  forum: { file: 'sfondo-forum', width: 560, ratio: 294 / 637, fadeRight: false },
  academia: { file: 'sfondo-labs', width: 560, ratio: 294 / 625, fadeRight: false },
};

/** A plate shorter than this would be a smudge, not a scene. */
const MIN_HEIGHT = 140;

/** Pages with no plate: Learn's «Oggi» (rule 3). */
const WITHOUT = [/^\/learn\/ripasso\/?$/];

export function SectionBackdrop({ section, pathname, scroller }: { section: SectionId; pathname: string; scroller: HTMLElement | null }) {
  const plate = PLATES[section];
  const tallest = Math.round(plate.width * plate.ratio);
  // The room under the content, less 16 px of air; under MIN_HEIGHT there is no plate.
  const [room, setRoom] = useState(0);
  const excluded = WITHOUT.some((re) => re.test(pathname));

  useEffect(() => {
    const content = scroller?.querySelector<HTMLElement>('[data-testid="layout-content"]');
    if (!scroller || !content || excluded) return;
    const measure = () => {
      // The page's own bottom: the frame less its bottom padding (lg:pb-24 is air, not content).
      const pad = parseFloat(getComputedStyle(content).paddingBottom) || 0;
      const free = scroller.getBoundingClientRect().bottom - (content.getBoundingClientRect().bottom - pad);
      setRoom(Math.max(0, Math.floor(free - 16)));
    };
    // Once now (a page in the background never runs the observer's first call), then on every change of either box.
    const first = setTimeout(measure, 0);
    const watch = new ResizeObserver(measure);
    watch.observe(scroller);
    watch.observe(content);
    return () => {
      clearTimeout(first);
      watch.disconnect();
    };
  }, [scroller, excluded, pathname]);

  if (room < MIN_HEIGHT || excluded || !scroller) return null;
  // As tall as the room, up to the plate's own height, its width following.
  const height = Math.min(tallest, room);
  const width = Math.round(height / plate.ratio);
  const url = `url(${import.meta.env.BASE_URL}illustrations/${plate.file}.webp)`;
  // Work's and Learn's scenes are cut at the right: the cut fades into the paper (no new files needed).
  const masks = plate.fadeRight ? `${url}, linear-gradient(to left, transparent, #000 15%)` : url;
  const style: CSSProperties = {
    width,
    height,
    maskImage: masks,
    WebkitMaskImage: masks,
    maskSize: 'contain, 100% 100%',
    WebkitMaskSize: 'contain, 100% 100%',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'right bottom',
    WebkitMaskPosition: 'right bottom',
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  };
  return (
    <span
      aria-hidden
      data-section-backdrop={section}
      className="pointer-events-none absolute bottom-0 right-0 -z-10 hidden bg-slate-800 opacity-[0.06] print:hidden lg:block dark:bg-slate-100 dark:opacity-[0.08]"
      style={style}
    />
  );
}
