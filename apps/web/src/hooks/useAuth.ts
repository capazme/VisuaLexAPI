/**
 * Custom hook for authentication state management
 */
import { useState, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';
import { subscribeToUser } from '../services/authEvents';
import type { UserResponse } from '../types/api';
import { appStore } from '../store/useAppStore';
import { loadAssistantFeatures } from '../store/assistantProposals';
import { getErrorMessage } from '../utils/errors';
import { settleShortcutUndo } from '../components/ui/notifications/notifications';
import { claimBrowserFor, forgetUserData } from '../services/sessionEnd';
import { isRefusalStatus } from '../services/api';
// Registers the reset of the in-memory user state with `forgetUserData`, before any request can end a session.
import '../services/userDataReset';

/** The pauses before asking `/auth/me` again after a 429, a 5xx or no answer: about 15 s in all. */
const LOAD_USER_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

interface AuthState {
  user: UserResponse | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  /** `/auth/me` failed once and is being asked again (LC13's retries): the loading screen says so. */
  retrying?: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    isAuthenticated: authService.isAuthenticated(),
  });

  /**
   * Load current user info on mount
   */
  useEffect(() => {
    let unmounted = false;
    const loadUser = async (attempt = 0): Promise<void> => {
      if (!authService.isAuthenticated()) {
        // Also when the token went during a retry's pause: no token is never signed in.
        setState((prev) => ({ ...prev, loading: false, isAuthenticated: false }));
        return;
      }

      try {
        const user = await authService.getCurrentUser();
        // A browser marked as someone else's (their session ended without a sign-out) is emptied first.
        claimBrowserFor(user.id, { signIn: false });
        setState({
          user,
          loading: false,
          error: null,
          isAuthenticated: true,
        });

        // Fetch user data from API if not already loaded
        const store = appStore.getState();
        if (!store.isDataLoaded && !store.isLoadingData) {
          store.fetchUserData();
          // D7b: whether the server proposes passages at all, once as the app starts, not at each use of this hook.
          void loadAssistantFeatures();
        }
      } catch (error) {
        // Only a refusal (401, 403) or a token gone (a refused refresh cleared it) ends the session. A 429, a 5xx or
        // no answer keeps it: the user is asked again after a pause, still loading, a few times (LC13).
        const refused = !authService.isAuthenticated() || isRefusalStatus((error as { status?: unknown } | null)?.status);
        if (!refused && attempt < LOAD_USER_RETRY_DELAYS_MS.length) {
          if (!unmounted) setState((prev) => ({ ...prev, retrying: true }));
          await new Promise((resolve) => setTimeout(resolve, LOAD_USER_RETRY_DELAYS_MS[attempt]));
          if (!unmounted) await loadUser(attempt + 1);
          return;
        }
        // Retries over and the session kept: signed in with no user, which `ProtectedRoute` says in words.
        setState({
          user: null,
          loading: false,
          error: getErrorMessage(error) || 'Non riesco a leggere il tuo account. Riprova tra poco.',
          isAuthenticated: !refused,
        });
      }
    };

    loadUser();
    return () => {
      unmounted = true;
    };
  }, []);

  /**
   * Follow the user another instance changed (the development mode's switch), without a reload.
   */
  useEffect(
    () =>
      subscribeToUser((user) => {
        // Only the account this instance already reads (or none yet): never a stranger's.
        setState((prev) => (prev.isAuthenticated && (!prev.user || prev.user.id === user.id) ? { ...prev, user } : prev));
      }),
    []
  );

  /**
   * Register new user
   */
  const register = useCallback(async (email: string, username: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      await authService.register({ email, username, password });

      // Auto-login after registration
      await authService.login({ email, password });
      const currentUser = await authService.getCurrentUser();
      // What this browser holds of anyone else (a practice, a question to the assistant, Gymnasium's marks) goes.
      claimBrowserFor(currentUser.id, { signIn: true });

      setState({
        user: currentUser,
        loading: false,
        error: null,
        isAuthenticated: true,
      });

      return currentUser;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(error) || 'Registrazione non riuscita. Riprova tra poco.',
      }));
      throw error;
    }
  }, []);

  /**
   * Login user
   */
  const login = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      await authService.login({ email, password });
      const user = await authService.getCurrentUser();
      // What this browser holds of anyone else (a practice, a question to the assistant, Gymnasium's marks) goes.
      claimBrowserFor(user.id, { signIn: true });

      setState({
        user,
        loading: false,
        error: null,
        isAuthenticated: true,
      });

      // Fetch user data from API after successful login
      appStore.getState().fetchUserData();
      void loadAssistantFeatures();

      return user;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(error) || 'Accesso non riuscito. Riprova tra poco.',
      }));
      throw error;
    }
  }, []);

  /**
   * Logout user
   */
  const logout = useCallback(() => {
    // The last gesture on a highlight is carried out (its removals sent) while the token is still there: it said
    // nothing, so for the reader it is done (A4).
    settleShortcutUndo();
    // Everything of the person, from every store and from the browser's storage (`sessionEnd.ts`).
    forgetUserData();
    authService.logout();
    setState({
      user: null,
      loading: false,
      error: null,
      isAuthenticated: false,
    });
  }, []);

  /**
   * Change password
   */
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const updatedUser = await authService.changePassword({
          current_password: currentPassword,
          new_password: newPassword,
        });

        setState((prev) => ({
          ...prev,
          user: updatedUser,
          loading: false,
        }));

        return updatedUser;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: getErrorMessage(error) || 'Cambio della password non riuscito. Riprova tra poco.',
        }));
        throw error;
      }
    },
    []
  );

  /**
   * Turn the development mode on or off. Resolves once the server has answered and every mounted
   * instance has the new user; rejects (403, network) with the mode as it was.
   */
  const setDevMode = useCallback(async (enabled: boolean) => {
    await authService.setDevMode(enabled);
  }, []);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    isAdmin: state.user?.is_admin ?? false,
    isValidator: state.user?.lingo_validatore ?? false,
    // The administrator lets an account use the mode; the account chooses. The mode hides entries
    // and pages and never grants a permission, so it counts only when both are true.
    canUseDevMode: state.user?.dev_mode_allowed ?? false,
    devMode: (state.user?.dev_mode_allowed ?? false) && (state.user?.dev_mode ?? false),
    setDevMode,
    register,
    login,
    logout,
    changePassword,
    clearError,
  };
}
