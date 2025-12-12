/**
 * Registration form component - Refactored with glassmorphism and micro-interactions
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { UserPlus, Mail, Lock, User, Eye, EyeOff, AlertCircle, ArrowRight, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export function RegisterForm() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [isUsernameFocused, setIsUsernameFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  const { register, loading, error: authError } = useAuth();
  const navigate = useNavigate();

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
  const isUsernameValid = username.length > 0 && /^[a-zA-Z0-9_]+$/.test(username);
  const showUsernameValidation = username.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Basic validation
    if (!email || !username || !password) {
      setFormError('All fields are required');
      return;
    }

    if (password.length < 3) {
      setFormError('Password must be at least 3 characters');
      return;
    }

    try {
      await register(email, username, password);
      navigate('/', { replace: true });
    } catch (error: any) {
      setFormError(error.message || 'Registration failed. Please try again.');
    }
  };

  const error = formError || authError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F3F4F6] dark:bg-[#0F172A] relative overflow-hidden px-4">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-[420px] w-full relative z-10 p-6">
        {/* Logo/Header */}
        <div className="text-center mb-10 space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white rounded-2xl shadow-lg shadow-blue-500/20 mb-2 transform transition-transform hover:scale-105 duration-300">
            <UserPlus size={28} strokeWidth={2.5} />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            Visua<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">Lex</span>
          </h1>
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            Crea il tuo account
          </p>
        </div>

        {/* Registration Card with Glass Effect */}
        <div className="bg-white/70 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-gray-900/5 dark:ring-white/10 p-8 transition-all duration-300">
          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-1">
                Email
              </label>
              <div
                className={cn(
                  'relative group transition-all duration-300',
                  isEmailFocused ? 'transform scale-[1.02]' : ''
                )}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail
                    size={18}
                    className={cn(
                      'transition-colors',
                      isEmailFocused ? 'text-blue-500' : 'text-gray-400'
                    )}
                  />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setIsEmailFocused(true)}
                  onBlur={() => setIsEmailFocused(false)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400/70"
                  placeholder="name@company.com"
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Username Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-1">
                Username
              </label>
              <div
                className={cn(
                  'relative group transition-all duration-300',
                  isUsernameFocused ? 'transform scale-[1.02]' : ''
                )}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User
                    size={18}
                    className={cn(
                      'transition-colors',
                      isUsernameFocused ? 'text-blue-500' : 'text-gray-400'
                    )}
                  />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setIsUsernameFocused(true)}
                  onBlur={() => setIsUsernameFocused(false)}
                  className="w-full pl-10 pr-10 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400/70"
                  placeholder="johndoe"
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
                <p className="text-xs text-red-500 ml-1">Solo lettere, numeri e underscore</p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-1">
                Password
              </label>
              <div
                className={cn(
                  'relative group transition-all duration-300',
                  isPasswordFocused ? 'transform scale-[1.02]' : ''
                )}
              >
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock
                    size={18}
                    className={cn(
                      'transition-colors',
                      isPasswordFocused ? 'text-blue-500' : 'text-gray-400'
                    )}
                  />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  className="w-full pl-10 pr-12 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400/70"
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"
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
                      passwordStrength >= 1 ? 'bg-red-400' : 'bg-gray-200 dark:bg-gray-700'
                    )}
                  />
                  <div
                    className={cn(
                      'flex-1 rounded-full transition-colors',
                      passwordStrength >= 2 ? 'bg-yellow-400' : 'bg-gray-200 dark:bg-gray-700'
                    )}
                  />
                  <div
                    className={cn(
                      'flex-1 rounded-full transition-colors',
                      passwordStrength >= 3 ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-700'
                    )}
                  />
                  <div
                    className={cn(
                      'flex-1 rounded-full transition-colors',
                      passwordStrength >= 4 ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                    )}
                  />
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-xl font-semibold shadow-lg shadow-blue-500/25 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transform active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Crea Account{' '}
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Login Link */}
          <p className="mt-8 text-center text-sm text-gray-500 bg-white/50 dark:bg-white/5 py-2 rounded-lg mx-auto w-fit px-4 border border-gray-100 dark:border-white/5">
            Hai già un account?{' '}
            <Link
              to="/login"
              className="text-blue-600 font-semibold hover:text-blue-500 transition-colors"
            >
              Accedi
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
          © 2025 VisuaLex. All rights reserved.
        </p>
      </div>
    </div>
  );
}
