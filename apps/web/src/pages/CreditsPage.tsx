/**
 * «Crediti» (`/crediti`): the public sources VisuaLex reads and the typefaces it ships, with what we use of
 * each, the conditions, the line of attribution and the links. Public — reached without signing in, from the
 * login's foot and the user menu — and drawn from `data/credits.ts` alone. Every entry is an anchor
 * (`/crediti#corte-costituzionale`), so a short line elsewhere can point at its own entry. A page to consult, not to
 * read through (U1d): in the frame's whole width, an index «In questa pagina» beside the sources from 1024 px (in a row
 * of its own on a phone), the sources as cards, two a row from 1280 px. Only the layout changed: the lines are C1's.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, ExternalLink } from 'lucide-react';
import { CREDITS, CREDIT_GROUPS, type Credit } from '../data/credits';
import { FOCUS_RING, HIDDEN_SCROLLBAR } from '../constants/interactions';
import { cn } from '../lib/utils';
import { PageFrame } from '../components/layout/PageFrame';
import { groupAt } from './creditsIndex';

const LINK = cn(
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-md font-medium text-primary-700 underline-offset-4 hover:underline dark:text-primary-300',
  FOCUS_RING,
);

function ExternalAnchor({ href, label, name }: { href: string; label: string; name: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {label}
      <span className="sr-only">{` di ${name} (si apre in una nuova scheda)`}</span>
      <ExternalLink aria-hidden size={14} className="shrink-0" />
    </a>
  );
}

/** One entry. Exported for its worst-case test: every text breaks rather than widen a 390 px page. */
export function CreditEntry({ credit }: { credit: Credit }) {
  const titleId = `credito-${credit.id}`;
  return (
    <article
      id={credit.id}
      aria-labelledby={titleId}
      tabIndex={-1}
      // A card, as tall as its row's other one; its links at its foot.
      className={cn('flex h-full scroll-mt-6 flex-col rounded-xl border border-slate-200 bg-white p-5 md:p-6 dark:border-slate-800 dark:bg-slate-900', FOCUS_RING)}
    >
      <h3 id={titleId} className="font-serif text-xl font-medium text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">
        {credit.name}
      </h3>
      <p className="mt-0.5 text-sm text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400">{credit.holder}</p>
      <dl className="mt-4 space-y-3 text-[15px] leading-relaxed [overflow-wrap:anywhere]">
        <div>
          <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Cosa usiamo</dt>
          <dd className="text-slate-800 dark:text-slate-200">{credit.uses}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Condizioni</dt>
          <dd className="text-slate-800 dark:text-slate-200">{credit.terms}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Attribuzione</dt>
          <dd
            data-attribution
            className="mt-1 border-l-2 border-primary-300 pl-3 font-serif text-slate-900 [overflow-wrap:anywhere] dark:border-primary-700 dark:text-slate-100"
          >
            {credit.attribution}
          </dd>
        </div>
      </dl>
      <p className="mt-auto flex flex-wrap gap-x-5 pt-3">
        <ExternalAnchor href={credit.sourceUrl} label="Sito della fonte" name={credit.name} />
        {credit.licenceUrl && <ExternalAnchor href={credit.licenceUrl} label="Testo della licenza" name={credit.name} />}
      </p>
    </article>
  );
}

/** The index's places: the groups, each a section of the page with its anchor (`/crediti#giurisprudenza`). */
const GROUPS = CREDIT_GROUPS.filter((group) => CREDITS.some((credit) => credit.group === group.id));

function useGroupInView(): string {
  const [current, setCurrent] = useState<string>(GROUPS[0]?.id ?? '');
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const tops = GROUPS.flatMap((group) => {
        const section = document.getElementById(group.id);
        return section ? [{ id: group.id, top: section.getBoundingClientRect().top }] : [];
      });
      const page = document.scrollingElement ?? document.documentElement;
      const atEnd = page.scrollHeight > window.innerHeight && window.scrollY + window.innerHeight >= page.scrollHeight - 2;
      setCurrent(groupAt(tops, window.innerHeight, atEnd));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return current;
}

const INDEX_LINK = cn(
  'flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-md border-transparent px-3 text-sm transition-colors lg:whitespace-normal lg:border-l-2',
  FOCUS_RING,
);

/** «In questa pagina»: beside the sources from 1024 px, staying in view; a row of its own that scrolls on a phone. */
function PageIndex({ current }: { current: string }) {
  return (
    // `min-w-0`: a grid item, it would otherwise grow to its row of links and widen a phone's page.
    <nav aria-label="In questa pagina" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
      <p aria-hidden className="mb-2 hidden px-3 text-sm font-medium text-slate-600 lg:block dark:text-slate-400">
        In questa pagina
      </p>
      {/* On a phone the row scrolls inside its band: the page never scrolls sideways. */}
      {/* `relative`, as every strip that scrolls (`apps/web/CLAUDE.md`); room for the focus ring on every side. */}
      <ul className={cn('relative -mx-1 -my-1 flex gap-1 overflow-x-auto px-1 py-1 lg:mx-0 lg:my-0 lg:flex-col lg:overflow-visible lg:px-0 lg:py-0', HIDDEN_SCROLLBAR)}>
        {GROUPS.map((group) => {
          const here = group.id === current;
          return (
            <li key={group.id}>
              <Link
                to={{ hash: group.id }}
                aria-current={here ? 'location' : undefined}
                className={cn(
                  INDEX_LINK,
                  // Marked by more than a tint: the weight, and from 1024 px the bar down its edge (the attribution's).
                  here
                    ? 'bg-primary-50 font-semibold text-primary-800 lg:border-primary-600 dark:bg-primary-950/50 dark:text-primary-200 dark:lg:border-primary-400'
                    : 'font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {group.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function CreditsPage() {
  const { hash, key } = useLocation();
  const current = useGroupInView();

  // The router renders after the browser has looked for the fragment, so the entry is reached here; focus
  // follows, for a screen reader, without a second scroll. No smooth scroll: nothing moves under reduced
  // motion, and an address opened is not an animation.
  useEffect(() => {
    if (!hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return; // a malformed fragment («#%») names no entry
    }
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  // The key too: the index's same item pressed again is a new navigation to the same fragment, and goes there again.
  }, [hash, key]);

  return (
    // The sections' frame (W2), outside the layout: its column (`max-w-7xl`, the layout's padding), the title at its left
    // edge in `PageFrame`'s size, the whole width used (U1d).
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-7xl p-4 pb-16 md:p-8 md:pb-16">
        <header>
          <Link to="/" className={cn('-ml-2 inline-flex min-h-[44px] items-center gap-2 rounded-md px-2 text-slate-700 dark:text-slate-300', FOCUS_RING)}>
            <BookOpen aria-hidden size={20} strokeWidth={1.5} className="text-primary-600 dark:text-primary-400" />
            <span className="font-serif text-lg font-medium">VisuaLex</span>
          </Link>
        </header>

        <main className="mt-8">
          <PageFrame title="Crediti">
            {/* The opening across the frame; the long paragraph at a reading measure. */}
            <p className="max-w-[70ch] font-serif text-lg leading-relaxed text-slate-700 dark:text-slate-300">
              VisuaLex usa i dati pubblici delle fonti elencate qui sotto e in questa pagina ne indica la provenienza:
              per ciascuna, cosa usiamo, a quali condizioni e come la citiamo. In fondo, i caratteri tipografici
              dell’interfaccia.
            </p>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
              <PageIndex current={current} />
              <div className="min-w-0">
                {GROUPS.map((group, index) => {
                  const entries = CREDITS.filter((credit) => credit.group === group.id);
                  const headingId = `crediti-${group.id}`;
                  return (
                    <section
                      key={group.id}
                      id={group.id}
                      aria-labelledby={headingId}
                      tabIndex={-1}
                      // Reached from the index, it takes the focus: its ring says where the keyboard is.
                      className={cn('scroll-mt-6 rounded-xl', FOCUS_RING, index > 0 && 'mt-12')}
                    >
                      <h2 id={headingId} className="font-serif text-2xl font-medium text-slate-900 dark:text-slate-50">
                        {group.title}
                      </h2>
                      {/* Two a row from 1280 px, as tall as each other; one below. */}
                      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {entries.map((credit) => (
                          <CreditEntry key={credit.id} credit={credit} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </PageFrame>
        </main>
      </div>
    </div>
  );
}
