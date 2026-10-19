/**
 * «Crediti» (`/crediti`): the public sources VisuaLex reads and the typefaces it ships, with what we use of
 * each, the conditions, the line of attribution and the links. Public — reached without signing in, from the
 * login's foot and the user menu — and drawn from `data/credits.ts` alone. Every entry is an anchor
 * (`/crediti#corte-costituzionale`), so a short line elsewhere can point at its own entry.
 */
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, ExternalLink } from 'lucide-react';
import { CREDITS, CREDIT_GROUPS, type Credit } from '../data/credits';
import { FOCUS_RING } from '../constants/interactions';
import { cn } from '../lib/utils';

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
      className="scroll-mt-6 border-t border-slate-200 py-6 outline-none first:border-t-0 first:pt-2 dark:border-slate-800"
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
      <p className="mt-3 flex flex-wrap gap-x-5">
        <ExternalAnchor href={credit.sourceUrl} label="Sito della fonte" name={credit.name} />
        {credit.licenceUrl && <ExternalAnchor href={credit.licenceUrl} label="Testo della licenza" name={credit.name} />}
      </p>
    </article>
  );
}

export function CreditsPage() {
  const { hash } = useLocation();

  // The router renders after the browser has looked for the fragment, so the entry is reached here; focus
  // follows, for a screen reader, without a second scroll. No smooth scroll: nothing moves under reduced
  // motion, and an address opened is not an animation.
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }, [hash]);

  return (
    <div className="min-h-dvh bg-slate-50 px-4 pb-16 pt-6 md:px-10 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-2xl">
        <Link to="/" className={cn('-ml-2 inline-flex min-h-[44px] items-center gap-2 rounded-md px-2 text-slate-700 dark:text-slate-300', FOCUS_RING)}>
          <BookOpen aria-hidden size={20} strokeWidth={1.5} className="text-primary-600 dark:text-primary-400" />
          <span className="font-serif text-lg font-medium">VisuaLex</span>
        </Link>

        <header className="mt-8 border-b border-slate-200 pb-6 dark:border-slate-800">
          <h1 className="font-serif text-4xl font-medium tracking-tight text-slate-900 md:text-5xl dark:text-slate-50">Crediti</h1>
          <p className="mt-4 max-w-prose font-serif text-lg leading-relaxed text-slate-700 dark:text-slate-300">
            VisuaLex usa i dati pubblici delle fonti elencate qui sotto e le attribuisce in questa pagina: per ciascuna,
            cosa usiamo, a quali condizioni e come la citiamo. In fondo, i caratteri con cui è scritta.
          </p>
        </header>

        <main>
          {CREDIT_GROUPS.map((group) => {
            const entries = CREDITS.filter((credit) => credit.group === group.id);
            if (entries.length === 0) return null;
            const headingId = `crediti-${group.id}`;
            return (
              <section key={group.id} aria-labelledby={headingId} className="mt-10">
                <h2 id={headingId} className="font-serif text-2xl font-medium text-slate-900 dark:text-slate-50">
                  {group.title}
                </h2>
                <div className="mt-2">
                  {entries.map((credit) => (
                    <CreditEntry key={credit.id} credit={credit} />
                  ))}
                </div>
              </section>
            );
          })}
        </main>
      </div>
    </div>
  );
}
