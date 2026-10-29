/**
 * Whether a click on a notification is one (K1a): a press that moved the notification (a swipe, even a short one that
 * sprang back) is no click on «Annulla» or ✕ under the pointer; a key's click (`detail` 0: Enter, Space, a screen
 * reader) always is. The flag the move leaves goes once its release has been seen, or a swipe let go outside the
 * notification (a finger's clicks nothing) would eat the next real click.
 */
export function createSwipeGuard(defer: (run: () => void) => void = (run) => window.setTimeout(run, 0)) {
  let moved = false;
  return {
    /** The notification started to move under the pointer. */
    started() {
      moved = true;
    },
    /** It was let go: the click that follows the release, if any, comes before the flag goes. */
    ended() {
      defer(() => {
        moved = false;
      });
    },
    /** A new press: nothing moved yet. */
    pressed() {
      moved = false;
    },
    /** Whether this click is to be dropped; dropping it spends the flag. */
    eats(detail: number): boolean {
      if (!moved || detail === 0) return false;
      moved = false;
      return true;
    },
    get moving() {
      return moved;
    },
  };
}
