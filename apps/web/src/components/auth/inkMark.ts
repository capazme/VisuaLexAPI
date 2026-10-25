/**
 * The sign-in wordmark written in ink (A3): which way it is written. On WebKit for iOS — an iPhone, an iPod, an iPad,
 * and an iPad with a Mac's user agent and touch points (every browser there is WebKit) — a soft-edged mask over a
 * moving edge is the part most likely to stutter, so there the word comes in with a fade from the left, no mask and
 * no blur: the brief's fallback.
 */
export function isIOSWebKit(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  return /iP(hone|ad|od)/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** The animations that end the writing: the ink's mask, or the fade of the fallback. */
export const INK_ENDS = ['vlx-ink-write', 'vlx-ink-plain'];
