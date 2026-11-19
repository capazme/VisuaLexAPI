/**
 * The sign-in form, the «Accedi» tab of `AuthPage` (spec 2026-10-18-redesign-inchiostro §5.3.4).
 */
import { useEffect, useRef, useState } from 'react';
import type { useAuth } from '../../hooks/useAuth';
import { useLocation } from 'react-router-dom';
import { getErrorMessage } from '../../utils/errors';
import { locationToPath, takeReturnTo } from '../../utils/returnTo';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { FIELD_CONTROL_INVALID, FIELD_LABEL } from '../ui/controlStyles';
import { focusField } from './authForm';
import { FormError, PasswordToggle } from './AuthFormParts';

const ERROR_ID = 'login-error';

interface LoginFormProps {
  /** The page's one `useAuth`. */
  auth: Pick<ReturnType<typeof useAuth>, 'login' | 'loading' | 'error'>;
  /** A request in flight, or none: the page holds the tabs still meanwhile. */
  onBusy: (busy: boolean) => void;
  /** Signed in: where to go, which the page enters with its animation. */
  onSignedIn: (to: string) => void;
  /** «Registrati»: the other tab. */
  onSwitch: () => void;
}

export function LoginForm({ auth, onBusy, onSignedIn, onSwitch }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [invalid, setInvalid] = useState<'email' | 'password' | null>(null);

  const { login, loading, error: authError } = auth;
  const location = useLocation();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<HTMLInputElement | null>(null);

  // A field the error points at while the request still disabled it takes the focus once enabled.
  useEffect(() => {
    if (pendingFocus.current && !pendingFocus.current.disabled) {
      pendingFocus.current.focus();
      pendingFocus.current = null;
    }
  });

  // Back where the user was sent from, query and fragment included: the consent page carries
  // its request there (/connect?request=…). Only paths of the app (utils/returnTo).
  const fromState = locationToPath((location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from);

  const fail = (message: string, field: 'email' | 'password') => {
    setFormError(message);
    setInvalid(field);
    focusField(field === 'email' ? emailRef.current : passwordRef.current, pendingFocus);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setInvalid(null);

    if (!email || !password) {
      fail('Inserisci email e password.', email ? 'password' : 'email');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail('Questo indirizzo email non sembra valido.', 'email');
      return;
    }

    onBusy(true);
    try {
      await login(email, password);
      const stashed = takeReturnTo(); // always spent, so a stale address never returns later
      onSignedIn(fromState ?? stashed ?? '/');
    } catch (error) {
      fail(getErrorMessage(error) || 'Accesso non riuscito: controlla email e password.', 'password');
    } finally {
      onBusy(false);
    }
  };

  const error = formError || authError;
  const describedBy = (field: 'email' | 'password') => (error && invalid === field ? ERROR_ID : undefined);

  return (
    <>
      {/* The tab says it on screen; the heading lets a screen reader's list of headings reach the form. */}
      <h2 className="sr-only">Accedi</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* The error is said by the box under the submit button (`FormError`), not under the field: no `error` here, only its red edge. */}
        <Input
          ref={emailRef}
          id="login-email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cn(invalid === 'email' && FIELD_CONTROL_INVALID)}
          placeholder="nome@studio.it"
          disabled={loading}
          autoComplete="email"
          aria-invalid={invalid === 'email' || undefined}
          aria-describedby={describedBy('email')}
        />

        <div>
          {/* The label outside the field's box, so the eye sits on the field alone. */}
          <label htmlFor="login-password" className={FIELD_LABEL}>
            Password
          </label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn('pr-12', invalid === 'password' && FIELD_CONTROL_INVALID)}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="current-password"
              aria-invalid={invalid === 'password' || undefined}
              aria-describedby={describedBy('password')}
            />
            <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
          </div>
        </div>

        <Button type="submit" loading={loading} className="w-full">
          Accedi
        </Button>
        {error && <FormError id={ERROR_ID} message={error} />}
      </form>

      <p className="mt-2 flex flex-wrap items-center gap-x-1 text-sm text-slate-600 dark:text-slate-400">
        Non hai un account?
        <Button type="button" variant="link" onClick={onSwitch}>
          Registrati
        </Button>
      </p>
    </>
  );
}
