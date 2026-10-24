/**
 * The dialogs open, oldest first: `Modal`, `WireConfirm` and `CompareView`. Each one registers its Tab trap on
 * `document` and its Esc handler (on `document`, the comparison's on `window`); with a dialog opened from another
 * dialog, only the last one opened may act, or the parent would pull the focus back from its child, or close with it.
 */
const open: symbol[] = [];

/** Registers a dialog as open; the function returned takes it off. */
export function openDialog(token: symbol): () => void {
  open.push(token);
  return () => {
    const at = open.indexOf(token);
    if (at !== -1) open.splice(at, 1);
  };
}

/** Whether this dialog is the last one opened, the one the keys are for. */
export function isTopmostDialog(token: symbol): boolean {
  return open[open.length - 1] === token;
}
