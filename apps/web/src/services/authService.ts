/**
 * Authentication service for user registration, login, and token management
 */
import { post, get, put } from './api';
import type {
  UserRegisterRequest,
  UserLoginRequest,
  TokenResponse,
  UserResponse,
  ChangePasswordRequest,
  RegisterResponse,
} from '../types/api';

/**
 * Register a new user (returns pending approval status)
 */
export const register = async (data: UserRegisterRequest): Promise<RegisterResponse> => {
  return post<RegisterResponse>('/auth/register', data);
};

/**
 * Login user and store tokens
 */
export const login = async (credentials: UserLoginRequest): Promise<TokenResponse> => {
  const response = await post<TokenResponse>('/auth/login', credentials);

  // Store tokens in localStorage
  localStorage.setItem('access_token', response.access_token);
  localStorage.setItem('refresh_token', response.refresh_token);

  return response;
};

/**
 * Logout user (clear tokens)
 */
export const logout = (): void => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  // Optionally redirect to login page
  window.location.href = '/login';
};

/**
 * Get current authenticated user info
 */
export const getCurrentUser = async (): Promise<UserResponse> => {
  return get<UserResponse>('/auth/me');
};

/**
 * Change user password
 */
export const changePassword = async (data: ChangePasswordRequest): Promise<UserResponse> => {
  return put<UserResponse>('/auth/change-password', data);
};

/**
 * Check if user is authenticated (has any access token in storage).
 *
 * Intentionally does NOT verify `exp`: an expired access_token is still a
 * signal that the user has a session and lets the refresh flow kick in.
 * Call `isAccessTokenExpired()` when you specifically need freshness.
 */
export const isAuthenticated = (): boolean => {
  const token = localStorage.getItem('access_token');
  return token !== null;
};

/**
 * Decode the `exp` claim (unix seconds) from a JWT without verifying the
 * signature. Returns null if the token is malformed or has no `exp`.
 * Used purely to decide if we should refresh proactively — the backend
 * still verifies signatures on every request.
 */
function readExpSeconds(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // Base64URL → base64, pad to multiple of 4
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '==='.slice((base64.length + 3) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * True if the stored access token is missing an `exp` that is still in the
 * future. A small clock-skew window keeps us from racing the exact boundary.
 */
export const isAccessTokenExpired = (skewSeconds = 10): boolean => {
  const exp = readExpSeconds(localStorage.getItem('access_token'));
  if (exp === null) return false;
  return exp * 1000 <= Date.now() + skewSeconds * 1000;
};

/**
 * Get access token from localStorage
 */
export const getAccessToken = (): string | null => {
  return localStorage.getItem('access_token');
};

/**
 * Get refresh token from localStorage
 */
export const getRefreshToken = (): string | null => {
  return localStorage.getItem('refresh_token');
};
