/**
 * Login form: the colophon beside the form, on paper (spec 2026-10-18-redesign-inchiostro §5.3.4).
 */
import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { BookOpen, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { BookMark } from '../ui/BookMark';
import { getErrorMessage } from '../../utils/errors';
import { locationToPath, takeReturnTo } from '../../utils/returnTo';
import { FOCUS_RING } from '../../constants/interactions';

// Entering the app (spec §6.3.1): once per session the book traces itself, then the app comes in.
const ENTRY_MS = 720;

function enter(go: () => void) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return go();
  window.setTimeout(() => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition) doc.startViewTransition(go);
    else go();
  }, ENTRY_MS);
}

const FIELD =
  'w-full h-11 rounded-md border border-slate-200 bg-slate-50 px-3.5 text-base md:text-[15px] text-slate-900 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [entering, setEntering] = useState(false);

  const { login, loading, error: authError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Back where the user was sent from, query and fragment included: the consent page carries
  // its request there (/connect?request=…). Only paths of the app (utils/returnTo).
  const fromState = locationToPath((location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!email || !password) {
      setFormError('Inserisci email e password.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Questo indirizzo email non sembra valido.');
      return;
    }

    try {
      await login(email, password);
      const stashed = takeReturnTo(); // always spent, so a stale address never returns later
      setEntering(true);
      enter(() => navigate(fromState ?? stashed ?? '/', { replace: true }));
    } catch (error) {
      setFormError(getErrorMessage(error) || 'Accesso non riuscito: controlla email e password.');
    }
  };

  const error = formError || authError;

  if (entering) {
    return (
      <div role="status" aria-label="Accesso a VisuaLex" className="fixed inset-0 grid place-items-center bg-slate-50 text-primary-600 dark:bg-slate-950 dark:text-primary-400">
        <BookMark size={56} draw />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 flex flex-col px-4 py-10 md:px-10">
      <div className="mx-auto my-auto grid w-full max-w-5xl items-center gap-12 md:grid-cols-[minmax(0,1fr)_420px] md:gap-16">
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

        <main className="rounded-2xl border border-slate-200 bg-white p-8 shadow-lg md:p-10 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-6 font-serif text-3xl font-medium text-slate-900 dark:text-slate-50">Accedi</h2>

          {error && (
            <div role="alert" className="mb-6 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3.5 animate-in fade-in slide-in-from-top-2 dark:border-red-900/50 dark:bg-red-950/40">
              <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD}
                placeholder="nome@studio.it"
                disabled={loading}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${FIELD} pr-12`}
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Nascondi la password' : 'Mostra la password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 font-semibold text-white transition-[background-color,transform] hover:bg-primary-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-400 dark:text-slate-950 dark:hover:bg-primary-300"
            >
              {loading ? (
                <BookOpen aria-label="Accesso in corso" size={18} className="animate-pulse" />
              ) : (
                'Accedi'
              )}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">
            Non hai un account?{' '}
            <Link to="/register" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
              Registrati
            </Link>
          </p>
        </main>
      </div>

      {/* The sources' attributions, readable before signing in. */}
      <footer className="mx-auto mt-10 w-full max-w-5xl text-sm text-slate-600 dark:text-slate-400">
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
