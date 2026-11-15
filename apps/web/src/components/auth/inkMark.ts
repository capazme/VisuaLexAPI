/**
 * WebKit for iOS — an iPhone, an iPod, an iPad, and an iPad with a Mac's user agent and touch points (every browser
 * there is WebKit) —, where a mask over a moving edge is the part most likely to stutter: the goal's mark takes its
 * fallback there (`goalMarkMotion.ts`). Born for the sign-in's wordmark written in ink (A3), which the logo replaced.
 */
export function isIOSWebKit(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  return /iP(hone|ad|od)/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}
