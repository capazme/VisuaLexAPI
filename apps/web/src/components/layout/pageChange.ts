import { dur, ease } from '../../lib/motion';

/** How far the coming page rises: the section change's 5 px (`vlx-page-in`, `index.css`). */
const RISE = 5;

/**
 * The places that are one page with views of their own (`ViewSlide`, `PageSlide`): any address under them is that page,
 * and its views move on their own. Pratiche's views live in the query, not in the path.
 */
const ONE_PAGE = ['/work', '/learn', '/forum/community', '/admin'];

/** The page an address shows (LC126): what changes it plays the page's fade. */
export function pageKeyOf(pathname: string): string {
  return ONE_PAGE.find((root) => pathname === root || pathname.startsWith(`${root}/`)) ?? pathname;
}

/** The coming page's entrance, as Web Animations timing and keyframes; under reduced motion only the fade. */
export function pageFade(still: boolean): { keyframes: Keyframe[]; timing: KeyframeAnimationOptions } {
  return {
    keyframes: [{ opacity: 0, transform: still ? 'none' : `translateY(${RISE}px)` }, { opacity: 1, transform: 'none' }],
    timing: { duration: dur.pop * 1000, easing: still ? 'linear' : `cubic-bezier(${ease.out.join(', ')})` },
  };
}
