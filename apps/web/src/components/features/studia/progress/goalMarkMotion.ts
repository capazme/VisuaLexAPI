import { isIOSWebKit } from '../../../auth/inkMark';

/**
 * WebKit — Safari, and every browser on an iPhone or an iPad — may not repaint a shape whose mask is animated by CSS:
 * the mark would stay at its first frame, unwritten. There it comes in with a short fade instead, whole (A3's fallback).
 */
export function writesInMasks(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  // Safari on a Mac: «Version/17.0 Safari/605.1.15», which Chrome's and Edge's agents never carry together.
  const safari = /Version\/[\d.]+.*Safari\//.test(nav.userAgent) && !/(Chrome|Chromium|Edg|OPR)\//.test(nav.userAgent);
  return !isIOSWebKit(nav) && !safari;
}
