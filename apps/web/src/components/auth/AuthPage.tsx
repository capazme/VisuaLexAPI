/**
 * Signing in and signing up on one page: the colophon beside a card with two tabs, «Accedi» and
 * «Registrati» (spec 2026-10-18-redesign-inchiostro §5.3.4). The address names the tab the page opens
 * on — `/login` or `/register` — and a change of tab replaces it, keeping the router state the return
 * after the login reads (`utils/returnTo`), so the page never reloads and the history does not grow.
 * The tab is the page's own state and the address follows it: React Router 7 applies a navigation in
 * a transition, a render after the page's own update, so a tab read from the address would let the
 * form leaving unmount for one render (and lose what was typed in it) on a quick change back. Nothing
 * in the app navigates between the two addresses while the page is open; something that did would
 * have to change the tab as well.
 *
 * The motion, once per change of tab: the mark under the tabs slides (`transform`, 200 ms), the form
 * leaving fades (120 ms) while the one coming in fades from 8 px on the side of its tab (180 ms), and
 * the card's height follows (200 ms). Under reduced motion the change is immediate.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** How long the form leaving stays (its fade, 120 ms, and a frame). */
const EXIT_MS = 140;
/** How long the card's height is held while it moves (200 ms, and a frame). */
const HEIGHT_MS = 220;

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
  // Once for the page: each change of tab mounts the sign-in form again, which would read the user
  // again (a request per change) and start disabled until the answer.
  const auth = useAuth();
  // Its error outlives the sign-in form, which a change of tab mounts again empty: an error already on
  // screen when the tab changes is not shown again (a new failure is the form's own message).
  const [staleError, setStaleError] = useState<string | null>(null);
  const loginAuth = { login: auth.login, loading: auth.loading, error: auth.error === staleError ? null : auth.error };
  // A request in flight (a sign-in, a sign-up): the tabs hold still, or the form would unmount under it
  // (an account created with no word of the approval it waits for; a sign-in landing from «Registrati»).
  const [busy, setBusy] = useState(false);

  const [entering, setEntering] = useState(false);
  // The form fading out, and whether the last change of tab moves at all (not on the first paint,
  // not under reduced motion).
  const [leaving, setLeaving] = useState<AuthTab | null>(null);
  const [animated, setAnimated] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<AuthTab, HTMLButtonElement | null>>({ login: null, register: null });
  const heightFrom = useRef<number | null>(null);
  const focusFirstField = useRef(false);
  const pendingFocus = useRef<HTMLInputElement | null>(null);
  const exitTimer = useRef<number | undefined>(undefined);
  const heightTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(exitTimer.current);
      window.clearTimeout(heightTimer.current);
    },
    [],
  );

  const firstField = (id: AuthTab) => frameRef.current?.querySelector<HTMLInputElement>(`#auth-panel-${id} input`) ?? null;

  // A first field still disabled (the user is being read) takes the focus once enabled.
  useEffect(() => {
    if (pendingFocus.current && !pendingFocus.current.disabled) {
      pendingFocus.current.focus();
      pendingFocus.current = null;
    }
  });

  const releaseHeight = () => {
    window.clearTimeout(heightTimer.current);
    const frame = frameRef.current;
    if (!frame) return;
    frame.style.height = '';
    frame.style.overflow = '';
  };

  const switchTo = (next: AuthTab, focus: 'field' | 'tab') => {
    if (busy) return;
    if (next === tab) {
      if (focus === 'field') focusField(firstField(tab), pendingFocus);
      return;
    }
    const still = prefersReducedMotion();
    window.clearTimeout(exitTimer.current);
    if (still) {
      setLeaving(null);
      releaseHeight();
    } else {
      // The height the card has now, mid-way through a previous change included.
      heightFrom.current = frameRef.current?.getBoundingClientRect().height ?? null;
      setLeaving(tab);
      exitTimer.current = window.setTimeout(() => setLeaving(null), EXIT_MS);
    }
    setAnimated(!still);
    setStaleError(auth.error);
    setTab(next);
    focusFirstField.current = focus === 'field';
    const target = TABS.find((t) => t.id === next)!.path;
    navigate({ pathname: target, search: location.search, hash: location.hash }, { replace: true, state: location.state });
  };

  // The card's height, from the form that left to the one that came: held at the old value, then
  // moved to the new one, then let go (`auto`), so a form that grows later (an error) is not clipped.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const from = heightFrom.current;
    heightFrom.current = null;
    if (!frame || from === null) return;
    const panel = frame.querySelector<HTMLElement>(`#auth-panel-${tab}`);
    if (!panel) return;
    window.clearTimeout(heightTimer.current);
    frame.style.overflow = 'hidden';
    frame.style.height = `${from}px`;
    frame.getBoundingClientRect(); // commit the old height before moving to the new one
    frame.style.height = `${panel.offsetHeight}px`;
    heightTimer.current = window.setTimeout(releaseHeight, HEIGHT_MS);
  }, [tab]);

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
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 flex flex-col px-4 py-10 md:px-10">
      {/* Anchored at the top, not centred: the card's height changes with the tab, and a centred page
          would move as a whole (about 90 px at 1920 px), the clicked tab running from the pointer. */}
      <div className="mx-auto grid w-full max-w-5xl items-start gap-12 md:mt-16 md:grid-cols-[minmax(0,1fr)_420px] md:gap-16">
        <header className="space-y-5">
          <BookOpen aria-hidden="true" size={44} strokeWidth={1.5} className="text-primary-600 dark:text-primary-400" />
          <h1 className="font-serif text-5xl font-medium tracking-tight text-slate-900 dark:text-slate-50 md:text-6xl">
            VisuaLex
          </h1>
          <p className="max-w-[34ch] font-serif text-xl leading-relaxed text-slate-600 dark:text-slate-300">
            Le norme italiane ed europee, le sentenze che le leggono, e il tuo lavoro sopra: note, evidenziazioni, dossier.
          </p>
          <ul className="space-y-1.5 text-sm text-slate-500 dark:text-slate-400">
            <li>Normattiva · EUR-Lex</li>
            <li>Cassazione · Corte costituzionale · Corte di giustizia</li>
            <li>Pratiche, dossier e schede di ripasso</li>
          </ul>
        </header>

        <main className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8 md:p-10 dark:border-slate-800 dark:bg-slate-900">
          <div
            role="tablist"
            aria-label="Accedi o registrati"
            onKeyDown={onTabKeyDown}
            className="relative mb-7 flex border-b border-slate-200 dark:border-slate-800"
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
                  aria-controls={selected ? `auth-panel-${t.id}` : undefined}
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
              className="pointer-events-none absolute -bottom-px left-0 h-0.5 w-1/2 rounded-full bg-primary-600 transition-transform duration-200 ease-out dark:bg-primary-400"
              style={{ transform: tab === 'register' ? 'translateX(100%)' : 'translateX(0)' }}
            />
          </div>

          {/* The frame clips only while its height moves; the panels' 8 px padding keeps the fields'
              focus rings, and the 8 px a form comes in from, inside it. */}
          <div ref={frameRef} className="relative -m-2 transition-[height] duration-200 ease-out">
            {TABS.filter((t) => t.id === tab || t.id === leaving).map((t) => {
              const isLeaving = t.id !== tab;
              const enterFrom = t.id === 'register' ? 'slide-in-from-right-2' : 'slide-in-from-left-2';
              return (
                <div
                  key={t.id}
                  id={`auth-panel-${t.id}`}
                  role="tabpanel"
                  aria-labelledby={`auth-tab-${t.id}`}
                  aria-hidden={isLeaving || undefined}
                  inert={isLeaving}
                  data-leaving={isLeaving || undefined}
                  className={
                    isLeaving
                      ? 'pointer-events-none absolute inset-x-0 top-0 p-2 opacity-0 transition-opacity duration-[120ms] ease-out'
                      : `p-2 ${animated ? `animate-in fade-in ${enterFrom}` : ''}`
                  }
                >
                  {t.id === 'login' ? (
                    <LoginForm auth={loginAuth} onBusy={setBusy} onSignedIn={onSignedIn} onSwitch={() => switchTo('register', 'field')} />
                  ) : (
                    <RegisterForm onBusy={setBusy} onSwitch={() => switchTo('login', 'field')} />
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* The sources' attributions, readable before signing in. */}
      <footer className="mx-auto mt-auto w-full max-w-5xl pt-10 text-sm text-slate-600 dark:text-slate-400">
        <Link
          to="/crediti"
          className={`-ml-2 inline-flex min-h-[44px] items-center rounded-md px-2 hover:text-slate-900 hover:underline dark:hover:text-slate-100 ${FOCUS_RING}`}
        >
          Crediti
        </Link>
      </footer>
    </div>
  );
}
