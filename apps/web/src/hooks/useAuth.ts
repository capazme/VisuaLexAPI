/**
 * Custom hook for authentication state management
 */
import { useState, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';
import { subscribeToUser } from '../services/authEvents';
import type { UserResponse } from '../types/api';
import { appStore } from '../store/useAppStore';
import { getErrorMessage } from '../utils/errors';
import { clearDecisionCache } from '../utils/decisionFetchCache';
import { clearDecisionSearchCache } from '../utils/decisionSearchCache';
import { clearEuCaseLawCache } from '../utils/euCaseLawCache';
import { clearArticleCardsCache } from '../utils/articleCardsCache';
import { clearConsentRead } from '../features/merlt/consent/consentRead';

interface AuthState {
  user: UserResponse | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
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
    const loadUser = async () => {
      if (!authService.isAuthenticated()) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      try {
        const user = await authService.getCurrentUser();
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
        }
      } catch (error) {
        setState({
          user: null,
          loading: false,
          error: getErrorMessage(error) || 'Failed to load user',
          isAuthenticated: false,
        });
      }
    };

    loadUser();
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
        error: getErrorMessage(error) || 'Registration failed',
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

      setState({
        user,
        loading: false,
        error: null,
        isAuthenticated: true,
      });

      // Fetch user data from API after successful login
      appStore.getState().fetchUserData();

      return user;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(error) || 'Login failed',
      }));
      throw error;
    }
  }, []);

  /**
   * Logout user
   */
  const logout = useCallback(() => {
    authService.logout();
    // Clear user data from store
    appStore.getState().clearUserData();
    clearDecisionCache();
    clearDecisionSearchCache();
    clearEuCaseLawCache();
    clearArticleCardsCache();
    clearConsentRead();
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
          error: getErrorMessage(error) || 'Password change failed',
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
