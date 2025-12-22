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
 * Check if user is authenticated
 */
export const isAuthenticated = (): boolean => {
  const token = localStorage.getItem('access_token');
  return token !== null;
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
