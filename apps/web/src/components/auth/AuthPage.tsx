/**
 * Signing in and signing up on one page: the colophon beside a card with two tabs, «Accedi» and
 * «Registrati» (spec 2026-10-18-redesign-inchiostro §5.3.4). The address names the tab the page opens
 * on — `/login` or `/register` — and a change of tab replaces it, keeping the router state the return
 * after the login reads (`utils/returnTo`), so the page never reloads and the history does not grow.
 * The tab is the page's own state and the address follows it: React Router 7 applies a navigation in
 * a transition, a render after the page's own update, so a tab read from the address would lag one
 * render behind the click (the form leaving shown again for a frame on a quick change back). Nothing
 * in the app navigates between the two addresses while the page is open; something that did would
 * have to change the tab as well.
 *
 * The page holds still across a change of tab (A1b): both forms stay mounted in one cell of a grid, the
 * one not shown hidden by `visibility`, so the card is as tall as the taller of the two whichever is
 * open; «Crediti» is the last row of a grid as tall as the window; and the page scrolls in its own
 * box with `scrollbar-gutter: stable`, so a window too low for it does not shift sideways when a bar
 * appears. The motion, once per change of tab: the mark under the tabs slides (`transform`, 200 ms),
 * the form leaving fades (120 ms) while the one coming in fades from 8 px on the side of its tab
 * (180 ms). Under reduced motion the change is immediate.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { BookMark } from '../ui/BookMark';
import { FOCUS_RING } from '../../constants/interactions';
import { useAuth } from '../../hooks/useAuth';
import { authPageTab, isLoginPage } from '../../utils/returnTo';
import { focusField } from './authForm';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

export type AuthTab = 'login' | 'register';

const TABS: { id: AuthTab; label: string; path: string }[] = [
  { id: 'login', label: 'Accedi', path: '/login' },
  { id: 'register', label: 'Registrati', path: '/register' },
];

// Entering the app (spec §6.3.1): once per session the book traces itself, then the app comes in.
const ENTRY_MS = 720;

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function enter(go: () => void) {
  if (prefersReducedMotion()) return go();
  window.setTimeout(() => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition) doc.startViewTransition(go);
    else go();
  }, ENTRY_MS);
}


export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<AuthTab>(() => authPageTab(location.pathname) ?? 'login');
  // Read by the page, which passes it to the sign-in form.
  const auth = useAuth();
  // A request in flight (a sign-in, a sign-up): the tabs hold still, or its answer would land on the
  // hidden form (an account created with no word of the approval it waits for; a sign-in landing from
  // «Registrati»).
  const [busy, setBusy] = useState(false);

  const [entering, setEntering] = useState(false);
  // Whether the last change of tab moves at all (not on the first paint, not under reduced motion).
  const [animated, setAnimated] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<AuthTab, HTMLButtonElement | null>>({ login: null, register: null });
  const focusFirstField = useRef(false);
  const pendingFocus = useRef<HTMLInputElement | null>(null);

  const firstField = (id: AuthTab) => frameRef.current?.querySelector<HTMLInputElement>(`#auth-panel-${id} input`) ?? null;

  // A first field still disabled (the user is being read) takes the focus once enabled.
  useEffect(() => {
    if (pendingFocus.current && !pendingFocus.current.disabled) {
      pendingFocus.current.focus();
      pendingFocus.current = null;
    }
  });

  const switchTo = (next: AuthTab, focus: 'field' | 'tab') => {
    if (busy) return;
    if (next === tab) {
      if (focus === 'field') focusField(firstField(tab), pendingFocus);
      return;
    }
    setAnimated(!prefersReducedMotion());
    setTab(next);
    focusFirstField.current = focus === 'field';
    const target = TABS.find((t) => t.id === next)!.path;
    navigate({ pathname: target, search: location.search, hash: location.hash }, { replace: true, state: location.state });
  };

  // A change by a click or by the link under a form puts the cursor in the new form's first field;
  // by the arrows the focus stays on the tab, so the arrows keep working.
  useEffect(() => {
    if (!focusFirstField.current) return;
    focusFirstField.current = false;
    focusField(firstField(tab), pendingFocus);
  }, [tab]);

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.id === tab);
    let next: AuthTab | null = null;
    if (e.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length].id;
    else if (e.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length].id;
    else if (e.key === 'Home') next = TABS[0].id;
    else if (e.key === 'End') next = TABS[TABS.length - 1].id;
    if (!next) return;
    e.preventDefault();
    if (busy) return;
    switchTo(next, 'tab');
    tabRefs.current[next]?.focus();
  };

  const onSignedIn = (to: string) => {
    setEntering(true);
    // Back to this very page would leave the entrance on screen: the page stays mounted.
    enter(() => navigate(isLoginPage(to.split(/[?#]/)[0]) ? '/' : to, { replace: true }));
  };

  if (entering) {
    return (
      <div role="status" aria-label="Accesso a VisuaLex" className="fixed inset-0 grid place-items-center bg-slate-50 text-primary-600 dark:bg-slate-950 dark:text-primary-400">
        <BookMark size={56} draw />
      </div>
    );
  }

  return (
    // The page is its own scroller, so the gutter it keeps for a bar is its own: a window too low for
    // the card scrolls without the page moving sideways.
    <div className="h-app overflow-y-auto bg-slate-50 [scrollbar-gutter:stable] dark:bg-slate-950">
      <div className="grid min-h-full grid-rows-[1fr_auto] px-4 md:px-10">
        {/* On a computer the card's top sits where the card would be centred above «Crediti» (40 rem:
            the card, about 36 rem, and the foot): a card that grows (an error, the password's strength)
            grows downwards, and the tabs never move. */}
        <div className="pb-6 pt-8 md:pt-[max(1.5rem,calc((100dvh-40rem)/2))]">
          <div className="mx-auto grid w-full max-w-4xl gap-8 md:grid-cols-[minmax(0,1fr)_420px] md:items-center md:gap-16">
            <header className="flex flex-col items-center gap-4 text-center md:items-start md:gap-5 md:text-left">
              <BookOpen aria-hidden="true" size={44} strokeWidth={1.5} className="text-primary-600 dark:text-primary-400" />
              <h1 className="font-serif text-5xl font-medium leading-none tracking-tight text-slate-900 dark:text-slate-50 md:text-[4.25rem]">
                VisuaLex
              </h1>
              <p className="max-w-[34ch] font-serif text-xl leading-relaxed text-slate-600 dark:text-slate-300">
                Le norme italiane ed europee, le sentenze che le leggono, e il tuo lavoro sopra: note, evidenziazioni, dossier.
              </p>
            </header>

            <main className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8 dark:border-slate-800 dark:bg-slate-900">
              <div
                role="tablist"
                aria-label="Accedi o registrati"
                onKeyDown={onTabKeyDown}
                className="relative mb-6 flex border-b border-slate-200 dark:border-slate-800"
              >
                {TABS.map((t) => {
                  const selected = t.id === tab;
                  return (
                    <button
                      key={t.id}
                      ref={(el) => {
                        tabRefs.current[t.id] = el;
                      }}
                      type="button"
                      role="tab"
                      id={`auth-tab-${t.id}`}
                      aria-selected={selected}
                      aria-controls={`auth-panel-${t.id}`}
                      tabIndex={selected ? 0 : -1}
                      aria-disabled={busy || undefined}
                      onClick={() => switchTo(t.id, 'field')}
                      className={`min-h-[44px] flex-1 rounded-t-md px-2 pb-3 pt-1 font-serif text-2xl font-medium transition-colors aria-disabled:cursor-not-allowed ${
                        selected
                          ? 'text-slate-900 dark:text-slate-50'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                      } ${FOCUS_RING}`}
                    >
                      {t.label}
                    </button>
                  );
                })}
                <span
                  aria-hidden="true"
                  data-testid="auth-tab-mark"
                  className="pointer-events-none absolute -bottom-px left-0 h-0.5 w-1/2 rounded-full bg-primary-600 transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-primary-400"
                  style={{ transform: tab === 'register' ? 'translateX(100%)' : 'translateX(0)' }}
                />
              </div>

              {/* Both forms in one cell: the card is as tall as the taller, whichever is shown. The one
                  hidden keeps what was typed in it, fades out (its `visibility` follows at the end of
                  the fade) and is out of reach meanwhile (`inert`). The panels' 8 px padding keeps the
                  fields' focus rings, and the 8 px a form comes in from, inside the card. */}
              <div ref={frameRef} className="-m-2 grid">
                {TABS.map((t) => {
                  const shown = t.id === tab;
                  const enterFrom = t.id === 'register' ? 'slide-in-from-right-2' : 'slide-in-from-left-2';
                  return (
                    <div
                      key={t.id}
                      id={`auth-panel-${t.id}`}
                      role="tabpanel"
                      aria-labelledby={`auth-tab-${t.id}`}
                      aria-hidden={!shown || undefined}
                      inert={!shown}
                      className={`col-start-1 row-start-1 p-2 transition-[opacity,visibility] duration-[120ms] ease-out motion-reduce:transition-none ${
                        shown ? (animated ? `animate-in fade-in ${enterFrom}` : '') : 'pointer-events-none invisible opacity-0'
                      }`}
                    >
                      {t.id === 'login' ? (
                        <LoginForm auth={auth} onBusy={setBusy} onSignedIn={onSignedIn} onSwitch={() => switchTo('register', 'field')} />
                      ) : (
                        <RegisterForm onBusy={setBusy} onSwitch={() => switchTo('login', 'field')} />
                      )}
                    </div>
                  );
                })}
              </div>
            </main>
          </div>
        </div>

        {/* The sources' attributions, readable before signing in: the grid's last row, at the foot of
            the window whatever the tab. */}
        <footer className="mx-auto w-full max-w-4xl pb-4 text-sm text-slate-600 dark:text-slate-400">
          <Link
            to="/crediti"
            className={`-ml-2 inline-flex min-h-[44px] items-center rounded-md px-2 hover:text-slate-900 hover:underline dark:hover:text-slate-100 ${FOCUS_RING}`}
          >
            Crediti
          </Link>
        </footer>
      </div>
    </div>
  );
}
