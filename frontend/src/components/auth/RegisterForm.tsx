/**
 * Registration form component - Glassmorphism style with pending approval flow
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { register } from '../../services/authService';
import { UserPlus, Mail, Lock, User, Eye, EyeOff, AlertCircle, ArrowLeft, CheckCircle, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export function RegisterForm() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Client-side validation
    if (!email || !username || !password || !confirmPassword) {
      setFormError('Tutti i campi sono obbligatori');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Formato email non valido');
      return;
    }

    if (username.length < 3) {
      setFormError('Username deve essere almeno 3 caratteri');
      return;
    }

    if (!isUsernameValid) {
      setFormError('Username può contenere solo lettere, numeri e underscore');
      return;
    }

    if (password.length < 3) {
      setFormError('Password deve essere almeno 3 caratteri');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Le password non coincidono');
      return;
    }

    try {
      setLoading(true);
      await register({ email, username, password });
      setRegistrationComplete(true);
    } catch (error: any) {
      setFormError(error.message || 'Errore durante la registrazione. Riprova.');
    } finally {
      setLoading(false);
    }
  };

  // Success state - registration complete, pending approval
  if (registrationComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F4F6] dark:bg-[#0F172A] relative overflow-hidden px-4">
        {/* Background Decorative Elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-green-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-[420px] w-full relative z-10 p-6">
          {/* Success Card */}
          <div className="bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-tr from-green-500 to-emerald-500 text-white rounded-2xl shadow-lg shadow-green-500/20 mb-6">
              <CheckCircle size={32} strokeWidth={2} />
            </div>

            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
              Registrazione Completata!
            </h1>

            <p className="text-slate-600 dark:text-slate-400 mb-6">
              Il tuo account è stato creato con successo.
              <br />
              <strong className="text-slate-800 dark:text-slate-200">
                È in attesa di approvazione da parte di un amministratore.
              </strong>
            </p>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Riceverai l'accesso quando un amministratore approverà il tuo account.
                Nel frattempo, puoi tornare alla pagina di login.
              </p>
            </div>

            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <ArrowLeft size={18} />
              Torna al Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F3F4F6] dark:bg-[#0F172A] relative overflow-hidden px-4">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-[420px] w-full relative z-10 p-6">
        {/* Logo/Header */}
        <div className="text-center mb-8 space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white rounded-2xl shadow-lg shadow-blue-500/20 mb-2 transform transition-transform hover:scale-105 duration-300">
            <UserPlus size={28} strokeWidth={2.5} />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Visua<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">Lex</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 font-medium">
            Crea il tuo account
          </p>
        </div>

        {/* Registration Card with Glass Effect */}
        <div className="bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 p-8 transition-all duration-300">
          {/* Error Message */}
          {formError && (
            <div className="mb-6 p-4 bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{formError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
                Email
              </label>
              <div
                className={cn(
                  'relative group transition-all duration-300',
                  focusedField === 'email' ? 'transform scale-[1.02]' : ''
                )}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail
                    size={18}
                    className={cn(
                      'transition-colors',
                      focusedField === 'email' ? 'text-blue-500' : 'text-slate-400'
                    )}
                  />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400/70"
                  placeholder="nome@email.com"
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Username Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
                Username
              </label>
              <div
                className={cn(
                  'relative group transition-all duration-300',
                  focusedField === 'username' ? 'transform scale-[1.02]' : ''
                )}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User
                    size={18}
                    className={cn(
                      'transition-colors',
                      focusedField === 'username' ? 'text-blue-500' : 'text-slate-400'
                    )}
                  />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400/70"
                  placeholder="mario_rossi"
                  disabled={loading}
                  autoComplete="username"
                />
                {/* Validation Icon */}
                {showUsernameValidation && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isUsernameValid ? (
                      <Check size={18} className="text-green-500" />
                    ) : (
                      <X size={18} className="text-red-500" />
                    )}
                  </div>
                )}
              </div>
              {showUsernameValidation && !isUsernameValid && (
                <p className="text-xs text-red-500 ml-1">Solo lettere, numeri e underscore (min 3 caratteri)</p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
                Password
              </label>
              <div
                className={cn(
                  'relative group transition-all duration-300',
                  focusedField === 'password' ? 'transform scale-[1.02]' : ''
                )}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock
                    size={18}
                    className={cn(
                      'transition-colors',
                      focusedField === 'password' ? 'text-blue-500' : 'text-slate-400'
                    )}
                  />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  className="w-full pl-10 pr-12 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400/70"
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-white/5"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Password Strength Indicator */}
              {password.length > 0 && (
                <div className="flex gap-1 h-1 mt-2">
                  <div
                    className={cn(
                      'flex-1 rounded-full transition-colors',
                      passwordStrength >= 1 ? 'bg-red-400' : 'bg-slate-200 dark:bg-slate-700'
                    )}
                  />
                  <div
                    className={cn(
                      'flex-1 rounded-full transition-colors',
                      passwordStrength >= 2 ? 'bg-yellow-400' : 'bg-slate-200 dark:bg-slate-700'
                    )}
                  />
                  <div
                    className={cn(
                      'flex-1 rounded-full transition-colors',
                      passwordStrength >= 3 ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-700'
                    )}
                  />
                  <div
                    className={cn(
                      'flex-1 rounded-full transition-colors',
                      passwordStrength >= 4 ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-700'
                    )}
                  />
                </div>
              )}
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
                Conferma Password
              </label>
              <div
                className={cn(
                  'relative group transition-all duration-300',
                  focusedField === 'confirmPassword' ? 'transform scale-[1.02]' : ''
                )}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock
                    size={18}
                    className={cn(
                      'transition-colors',
                      focusedField === 'confirmPassword' ? 'text-blue-500' : 'text-slate-400'
                    )}
                  />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => setFocusedField('confirmPassword')}
                  onBlur={() => setFocusedField(null)}
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400/70"
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="new-password"
                />
                {/* Match indicator */}
                {confirmPassword.length > 0 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {password === confirmPassword ? (
                      <Check size={18} className="text-green-500" />
                    ) : (
                      <X size={18} className="text-red-500" />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-xl font-semibold shadow-lg shadow-blue-500/25 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transform active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 mt-6"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Crea Account
                  <UserPlus size={18} className="group-hover:scale-110 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Login Link */}
          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Hai già un account?{' '}
            <Link to="/login" className="text-blue-600 hover:underline font-medium">
              Accedi
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
          © 2025 VisuaLex. All rights reserved.
        </p>
      </div>
    </div>
  );
}

