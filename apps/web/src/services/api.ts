/**
 * Centralized API client using axios with interceptors for authentication and error handling.
 */
import axios from 'axios';
import type { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { isAccessTokenExpired } from './authService';
import { stashReturnTo } from '../utils/returnTo';
import { forgetUserData } from './sessionEnd';
import { notify } from '../components/ui/notifications/notifications';

// API base URL - uses relative path to leverage Vite proxy in development
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Create axios instance with default config.
//
// NOTE: do NOT set a default `Content-Type` here. Axios 1.x already
// auto-detects per request (plain objects → application/json, FormData →
// multipart/form-data with the browser-generated boundary, URLSearchParams →
// x-www-form-urlencoded). A hardcoded default wins over `postForm()` and the
// FormData auto-detection on some builds, leaving the browser unable to send
// the body (surfaces as ERR_TIMED_OUT on uploads).
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds
});

/**
 * Single in-flight refresh promise. Multiple concurrent expired-token
 * requests piggyback on the same `/auth/refresh` call instead of each
 * firing their own (which produced N duplicate refreshes per article
 * mount before). Cleared once settled so the next genuine refresh goes
 * through.
 */
let refreshInFlight: Promise<string> | null = null;

/**
 * The session is over (the server refused the refresh): everything of the person goes, then the tokens, and the
 * sign-in page opens, which brings the reader back here.
 */
export function handleUnauthenticated(): void {
  forgetUserData();
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  stashReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  window.location.href = '/login';
}

/**
 * Whether a failed refresh means the session is over: the server answered and refused it (401, 403), or there
 * is no refresh token. A server error (5xx), a 429 or no answer at all (network, timeout) does not: the session
 * stays, the next request tries again (`refreshInFlight` is cleared once a refresh settles).
 */
export function isRefreshRefused(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status === 401 || status === 403;
  }
  // `No refresh token`: nothing to refresh with.
  return true;
}

/** The plain words a reader gets when a refresh could not reach the server. */
export const CONNECTION_FAILED_MESSAGE = 'Connessione al server non riuscita. La sessione resta aperta: riprova tra poco.';

let lastConnectionNotice = 0;

/** Tells the reader once (at most every 10 s, as many requests may fail together) that the connection failed. */
export function reportConnectionFailure(): void {
  const now = Date.now();
  if (now - lastConnectionNotice < 10_000) return;
  lastConnectionNotice = now;
  try {
    notify({ type: 'error', message: CONNECTION_FAILED_MESSAGE, duration: 6000, ariaLive: 'assertive' });
  } catch {
    // no notification host (tests, the sign-in page): the request's own error still reaches its caller
  }
}

/**
 * A failed refresh: a refused one ends the session; any other keeps it, tells the reader, and returns false so
 * the caller fails the request alone.
 */
export function settleRefreshFailure(error: unknown): boolean {
  if (isRefreshRefused(error)) {
    handleUnauthenticated();
    return true;
  }
  reportConnectionFailure();
  return false;
}

export async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    throw new Error('No refresh token');
  }

  refreshInFlight = axios
    .post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
    .then((response) => {
      const { access_token, refresh_token: nextRefresh } = response.data as {
        access_token: string;
        refresh_token: string;
      };
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', nextRefresh);
      return access_token;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/**
 * The access token to send now, for a request that does not go through axios (the
 * scraping calls use fetch: see legalFetch.ts). A token past its expiry is refreshed
 * first, through the same single in-flight promise as every other refresh; when the
 * refresh fails the stale token is returned, and the 401 that follows decides. With
 * `skewSeconds`, one that expires within them is refreshed too (a removal held for a
 * `keepalive` fetch, `deferredRemovals.ts`).
 */
export async function getFreshAccessToken(skewSeconds?: number): Promise<string | null> {
  const token = localStorage.getItem('access_token');
  if (token && isAccessTokenExpired(skewSeconds) && localStorage.getItem('refresh_token')) {
    try {
      return await refreshAccessToken();
    } catch (error) {
      // Fall through with the stale token. Refused: the 401 that follows ends the session. A server or network
      // error: the request may fail without a 401, so the reader is told here that the connection failed.
      if (!isRefreshRefused(error)) reportConnectionFailure();
    }
  }
  return token;
}

/**
 * Request interceptor: attach access token. If the token is expired and
 * a refresh_token is present, refresh *before* sending so the request
 * doesn't hit the server just to bounce back with 401.
 */
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // A stale token still goes out when the refresh fails: the response
    // interceptor catches the resulting 401 and performs the final redirect.
    const token = await getFreshAccessToken();

    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor to handle token refresh on 401 errors
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If error is 401 and we haven't retried yet, try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const access_token = await refreshAccessToken();

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
        }

        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refused: the session ends. A server or network error: the session stays and the reader is told.
        if (settleRefreshFailure(refreshError)) return Promise.reject(refreshError);
        const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
        return Promise.reject({ status, message: CONNECTION_FAILED_MESSAGE, data: undefined });
      }
    }

    // For other errors, reject with formatted error
    const responseData = error.response?.data as { detail?: string } | undefined;
    return Promise.reject({
      status: error.response?.status,
      message: responseData?.detail || error.message || 'An error occurred',
      data: responseData,
    });
  }
);

/**
 * Generic GET request
 */
export const get = async <T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> => {
  const response = await apiClient.get<T>(url, { params });
  return response.data;
};

/**
 * Generic POST request
 */
export const post = async <T = unknown>(url: string, data?: unknown): Promise<T> => {
  const response = await apiClient.post<T>(url, data);
  return response.data;
};

/**
 * Generic PUT request
 */
export const put = async <T = unknown>(url: string, data?: unknown): Promise<T> => {
  const response = await apiClient.put<T>(url, data);
  return response.data;
};

/**
 * Generic PATCH request
 */
export const patch = async <T = unknown>(url: string, data?: unknown): Promise<T> => {
  const response = await apiClient.patch<T>(url, data);
  return response.data;
};

/**
 * Generic DELETE request
 */
export const del = async <T = unknown>(url: string): Promise<T> => {
  const response = await apiClient.delete<T>(url);
  return response.data;
};

// Export as both named and default for flexibility
export { apiClient };
export default apiClient;
