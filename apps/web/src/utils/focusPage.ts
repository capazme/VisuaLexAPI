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
 * page is watched for `LANDING_MS`, or until the reader points somewhere. Returns the cleanup.
 *
 * An address reached with an anchor (`/impostazioni#amministrazione`, LC104): the anchored part's heading is the title,
 * once the part is drawn, even when the page focused its own title first; a focus the page gave inside the part stays.
 * The browser itself focuses an anchored part as it appears and, the part being no control, drops the focus to the body
 * (Papiniano, #608): a focus that falls to nothing while the page is watched goes back to the title.
 */
export function focusLanding(left: boolean): () => void {
  const before = new Set(document.querySelectorAll(PAGE_TITLE));
  const main = document.querySelector('main');
  const from = `${window.location.pathname}${window.location.search}`;
  let given: HTMLElement | null = null;
  const look = () => {
    const active = document.activeElement;
    const part = anchoredPart(from);
    if (part) {
      if (active && part.contains(active)) return;
      const heading = part.querySelector<HTMLElement>('h1, h2, h3, h4') ?? part;
      focusTitle(heading);
      given = heading;
      return;
    }
    // Something took the focus by itself (a reader that focuses itself): it keeps it. Not when an anchor waits for its
    // part (the page's title, given before the part is drawn, makes way for the part's heading).
    if (active && active !== document.body && active !== main && active !== given) {
      if (!anchorAhead(from)) stop();
      return;
    }
    // Never the title of a page or view that is leaving (`PageSlide`'s `inert` layer, LC98).
    const titles = [...document.querySelectorAll<HTMLElement>(PAGE_TITLE)].filter((el) => !el.closest('[inert]'));
    const title = titles.find((el) => !before.has(el)) ?? (left || given ? null : titles[0]);
    if (title && (title !== given || active !== given)) {
      focusTitle(title);
      given = title;
    }
  };
  // The focus fell to nothing (no element took it): look again once it has settled on the body.
  const fell = (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof Element)) window.setTimeout(look, 0);
  };
  focusPage();
  look();
  const observer = new MutationObserver(look);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('focusout', fell);
  document.addEventListener('pointerdown', stop);
  const timer = window.setTimeout(() => stop(), LANDING_MS);
  function stop() {
    observer.disconnect();
    document.removeEventListener('focusout', fell);
    document.removeEventListener('pointerdown', stop);
    window.clearTimeout(timer);
  }
  return stop;
}

/** The address has moved since `from` and carries an anchor. */
function anchorAhead(from: string): string | null {
  const { pathname, search, hash } = window.location;
  return hash.length > 1 && `${pathname}${search}` !== from ? decodeURIComponent(hash.slice(1)) : null;
}

/** The part the new address's anchor names, once drawn and not leaving. */
function anchoredPart(from: string): HTMLElement | null {
  const id = anchorAhead(from);
  const part = id ? document.getElementById(id) : null;
  return part && !part.closest('[inert]') ? part : null;
}
