// The logo's motions once a browser session (LC16, LC18): the shell's sweep (`Layout`), the phone drawer's sweep at its
// first opening, the sign-in page's intro. Each read and recorded by its own key.

/** Where the logo moves: the shell's bar, the phone's drawer, the sign-in page. */
export type LogoPlace = 'sweep' | 'sweep-drawer' | 'intro';

const logoKey = (place: LogoPlace) => `visualex-logo-${place}`;

/** The browser key that says the shell's sweep was played in this browser session. */
export const LOGO_SWEEP_KEY = logoKey('sweep');

/** Whether the motion is still due in this browser session; storage refused (it throws), it is not. */
export function logoSweepDue(place: LogoPlace = 'sweep'): boolean {
  try {
    return sessionStorage.getItem(logoKey(place)) === null;
  } catch {
    return false;
  }
}

/** Records the motion as played for this browser session. */
export function markLogoSweep(place: LogoPlace = 'sweep'): void {
  try {
    sessionStorage.setItem(logoKey(place), '1');
  } catch {
    // Storage refused: the motion is not due either (`logoSweepDue`).
  }
}
