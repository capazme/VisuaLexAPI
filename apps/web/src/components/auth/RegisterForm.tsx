/**
 * The sign-up form, the «Registrati» tab of `AuthPage`, and what follows it: the account waits for an
 * administrator's approval (spec 2026-10-18-redesign-inchiostro §5.3.4, as the sign-in form).
 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, CheckCircle2, X } from 'lucide-react';
import { register } from '../../services/authService';
import { cn } from '../../lib/utils';
import { getErrorMessage } from '../../utils/errors';
import { FIELD, LABEL, PRIMARY_BUTTON, SWITCH_LINK, focusField } from './authForm';
import { FormError, PasswordToggle } from './AuthFormParts';
import { FOCUS_RING } from '../../constants/interactions';

const ERROR_ID = 'register-error';

type Field = 'email' | 'username' | 'password' | 'confirmPassword';

// The four steps of the strength bar, in words for a screen reader (the bar shows them as segments).
const STRENGTH_WORDS = ['', 'molto debole', 'debole', 'buona', 'forte'];
const STRENGTH_FILL = ['', 'bg-red-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'];

interface RegisterFormProps {
  /** «Accedi» and «Torna ad Accedi»: the other tab. */
  onSwitch: () => void;
}

export function RegisterForm({ onSwitch }: RegisterFormProps) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [invalid, setInvalid] = useState<Field | null>(null);
  const [loading, setLoading] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);

  const refs = {
    email: useRef<HTMLInputElement>(null),
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmPassword: useRef<HTMLInputElement>(null),
  };
  const pendingFocus = useRef<HTMLInputElement | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  // A field the error points at while the request still disabled it takes the focus once enabled.
  useEffect(() => {
    if (pendingFocus.current && !pendingFocus.current.disabled) {
      pendingFocus.current.focus();
      pendingFocus.current = null;
    }
  });

  // The submit button that had the focus is gone: the confirmation takes it.
  useEffect(() => {
    if (registrationComplete) doneHeading.current?.focus();
  }, [registrationComplete]);

  // Password strength calculation
  const getPasswordStrength = () => {
    if (password.length === 0) return 0;
    if (password.length < 6) return 1;
    if (password.length >= 6 && password.length < 8) return 2;
    if (password.length >= 8 && /[0-9]/.test(password) && /[A-Z]/.test(password)) return 4;
    if (password.length >= 8 && /[0-9]/.test(password)) return 3;
    return 2;
  };

  const passwordStrength = getPasswordStrength();

  // Username validation
  const isUsernameValid = username.length >= 3 && /^[a-zA-Z0-9_]+$/.test(username);
  const showUsernameValidation = username.length > 0;

  const fail = (message: string, field: Field) => {
    setFormError(message);
    setInvalid(field);
    focusField(refs[field].current, pendingFocus);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setInvalid(null);

    // Client-side validation
    if (!email || !username || !password || !confirmPassword) {
      const empty: Field = !email ? 'email' : !username ? 'username' : !password ? 'password' : 'confirmPassword';
      fail('Tutti i campi sono obbligatori', empty);
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail('Formato email non valido', 'email');
      return;
    }

    if (username.length < 3) {
      fail('Username deve essere almeno 3 caratteri', 'username');
      return;
    }

    if (!isUsernameValid) {
      fail('Username può contenere solo lettere, numeri e underscore', 'username');
      return;
    }

    if (password.length < 3) {
      fail('Password deve essere almeno 3 caratteri', 'password');
      return;
    }

    if (password !== confirmPassword) {
      fail('Le password non coincidono', 'confirmPassword');
      return;
    }

    try {
      setLoading(true);
      await register({ email, username, password });
      setRegistrationComplete(true);
    } catch (error) {
      // The server does not say which field it refused («email or username already exists»).
      fail(getErrorMessage(error) || 'Errore durante la registrazione. Riprova.', 'email');
    } finally {
      setLoading(false);
    }
  };

  // Registration complete, pending approval: in the same card, in place of the form.
  if (registrationComplete) {
    return (
      <div className="space-y-5">
        <CheckCircle2 aria-hidden="true" size={32} strokeWidth={1.5} className="text-primary-600 dark:text-primary-400" />
        <h2
          ref={doneHeading}
          tabIndex={-1}
          className="font-serif text-2xl font-medium text-slate-900 outline-none dark:text-slate-50"
        >
          Registrazione completata
        </h2>
        <p className="text-slate-600 dark:text-slate-300">
          Il tuo account è stato creato con successo.{' '}
          <strong className="font-semibold text-slate-900 dark:text-slate-100">
            È in attesa di approvazione da parte di un amministratore.
          </strong>
        </p>
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Riceverai l'accesso quando un amministratore approverà il tuo account. Nel frattempo, puoi tornare ad Accedi.
        </p>
        <button
          type="button"
          onClick={onSwitch}
          className={`flex h-11 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 font-semibold text-slate-900 transition-[background-color,transform,scale] hover:bg-slate-50 active:scale-[0.97] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 ${FOCUS_RING}`}
        >
          Torna ad Accedi
        </button>
      </div>
    );
  }

  const describedBy = (field: Field, own?: string) =>
    [formError && invalid === field ? ERROR_ID : undefined, own].filter(Boolean).join(' ') || undefined;
  const usernameHint = showUsernameValidation && !isUsernameValid;

  return (
    <>
      {formError && <FormError id={ERROR_ID} message={formError} />}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="register-email" className={LABEL}>
            Email
          </label>
          <input
            ref={refs.email}
            id="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
            placeholder="nome@studio.it"
            disabled={loading}
            autoComplete="email"
            aria-invalid={invalid === 'email' || undefined}
            aria-describedby={describedBy('email')}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="register-username" className={LABEL}>
            Username
          </label>
          <div className="relative">
            <input
              ref={refs.username}
              id="register-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`${FIELD} pr-11`}
              placeholder="mario_rossi"
              disabled={loading}
              autoComplete="username"
              aria-invalid={invalid === 'username' || usernameHint || undefined}
              aria-describedby={describedBy('username', usernameHint ? 'register-username-hint' : undefined)}
            />
            {showUsernameValidation && (
              <span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 grid h-11 w-11 place-items-center">
                {isUsernameValid ? (
                  <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <X size={16} className="text-red-600 dark:text-red-400" />
                )}
              </span>
            )}
          </div>
          {usernameHint && (
            <p id="register-username-hint" className="text-xs text-red-700 dark:text-red-300">
              Solo lettere, numeri e underscore (min 3 caratteri)
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="register-password" className={LABEL}>
            Password
          </label>
          <div className="relative">
            <input
              ref={refs.password}
              id="register-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${FIELD} pr-12`}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="new-password"
              aria-invalid={invalid === 'password' || undefined}
              aria-describedby={describedBy('password')}
            />
            <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
          </div>

          {password.length > 0 && (
            <div role="img" aria-label={`Sicurezza della password: ${STRENGTH_WORDS[passwordStrength]}`} className="flex h-1 gap-1">
              {[1, 2, 3, 4].map((step) => (
                <div
                  key={step}
                  className={cn(
                    'flex-1 rounded-full transition-colors',
                    passwordStrength >= step ? STRENGTH_FILL[step] : 'bg-slate-200 dark:bg-slate-700',
                  )}
                />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="register-confirm-password" className={LABEL}>
            Conferma password
          </label>
          <div className="relative">
            <input
              ref={refs.confirmPassword}
              id="register-confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`${FIELD} pr-11`}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="new-password"
              aria-invalid={invalid === 'confirmPassword' || undefined}
              aria-describedby={describedBy('confirmPassword')}
            />
            {confirmPassword.length > 0 && (
              <span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 grid h-11 w-11 place-items-center">
                {password === confirmPassword ? (
                  <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <X size={16} className="text-red-600 dark:text-red-400" />
                )}
              </span>
            )}
          </div>
        </div>

        <button type="submit" disabled={loading} className={PRIMARY_BUTTON}>
          {loading ? <BookOpen aria-label="Registrazione in corso" size={18} className="animate-pulse" /> : 'Crea account'}
        </button>
      </form>

      <p className="mt-4 flex flex-wrap items-center gap-x-1 text-sm text-slate-600 dark:text-slate-400">
        Hai già un account?
        <button type="button" onClick={onSwitch} className={SWITCH_LINK}>
          Accedi
        </button>
      </p>
    </>
  );
}
