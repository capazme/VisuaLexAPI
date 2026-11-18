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

/** The page's title, made reachable by the focus while it holds it (as `focusPage` does for `<main>`). */
function focusTitle(title: HTMLElement) {
  if (!title.hasAttribute('tabindex')) {
    title.setAttribute('tabindex', '-1');
    title.addEventListener('blur', () => title.removeAttribute('tabindex'), { once: true });
  }
  title.focus({ preventScroll: true });
}

/** How long a page reached by a choice may take to draw its title (its code and its first data). */
const LANDING_MS = 3000;
/** A page's title, where the focus lands after a choice: marked on each page, an `h1` or an `h2` (Papiniano, #599). */
const PAGE_TITLE = 'main [data-page-title]';

/**
 * After a choice (Papiniano, #599): at once on `<main>`, never left on the body; then on the title of what the choice
 * opened — the first marked title that was not on screen before it (the page reached, a reader opened beside), or, on
 * the same page, the title there. `left`: the choice changed the address, so the titles on screen now are the page being
 * left (the router draws the new one a commit later), never focused. Whatever takes the focus by itself keeps it. The
 * page is watched for `LANDING_MS`. Returns the cleanup.
 */
export function focusLanding(left: boolean): () => void {
  const before = new Set(document.querySelectorAll(PAGE_TITLE));
  const main = document.querySelector('main');
  let given: HTMLElement | null = null;
  const look = () => {
    const active = document.activeElement;
    // Something took the focus by itself (a reader that focuses itself): it keeps it.
    if (active && active !== document.body && active !== main && active !== given) return stop();
    // Never the title of a page or view that is leaving (`PageSlide`'s `inert` layer, LC98).
    const titles = [...document.querySelectorAll<HTMLElement>(PAGE_TITLE)].filter((el) => !el.closest('[inert]'));
    const title = titles.find((el) => !before.has(el)) ?? (left || given ? null : titles[0]);
    if (title && title !== given) {
      focusTitle(title);
      given = title;
    }
  };
  focusPage();
  look();
  const observer = new MutationObserver(look);
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = window.setTimeout(() => stop(), LANDING_MS);
  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
  }
  return stop;
}
