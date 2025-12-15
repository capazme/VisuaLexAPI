/**
 * Custom hook for authentication state management
 */
import { useState, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';
import type { UserResponse } from '../types/api';
import { appStore } from '../store/useAppStore';

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
      } catch (error: any) {
        setState({
          user: null,
          loading: false,
          error: error.message || 'Failed to load user',
          isAuthenticated: false,
        });
      }
    };

    loadUser();
  }, []);

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
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message || 'Registration failed',
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
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message || 'Login failed',
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
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message || 'Password change failed',
        }));
        throw error;
      }
    },
    []
  );

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    isAdmin: state.user?.is_admin ?? false,
    register,
    login,
    logout,
    changePassword,
    clearError,
  };
}
