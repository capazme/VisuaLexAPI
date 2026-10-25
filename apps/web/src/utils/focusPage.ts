/**
 * Puts the focus on the page — `Layout`'s `<main>` — when what held it has gone (the «Novità» toast's «Vedi» and
 * «Chiudi notifica»), so a keyboard or a screen reader does not start again from the top of the body. `<main>` takes
 * the focus only for that moment: a `tabindex` it kept would make every click on the page focus it, and the previews
 * that give the focus back when it fell to the body (`DecisionPreviewDialog`) would stop doing so.
 */
export function focusPage() {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1');
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
  }
  main.focus({ preventScroll: true });
}
