// The shell's logo sweep (LC16, `LexCraftLogo`'s `sweep`): once a browser session, read and recorded by `Layout`.

/** The browser key that says the shell's sweep was played in this browser session. */
export const LOGO_SWEEP_KEY = 'visualex-logo-sweep';

/** Whether the shell's sweep is still due in this browser session; storage refused (it throws), it is not. */
export function logoSweepDue(): boolean {
  try {
    return sessionStorage.getItem(LOGO_SWEEP_KEY) === null;
  } catch {
    return false;
  }
}

/** Records the sweep as played for this browser session. */
export function markLogoSweep(): void {
  try {
    sessionStorage.setItem(LOGO_SWEEP_KEY, '1');
  } catch {
    // Storage refused: the sweep is not due either (`logoSweepDue`).
  }
}
