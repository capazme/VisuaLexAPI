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

/** The requests that send credentials: a 401 there is a wrong password, never an expired session. */
const CREDENTIAL_URLS = ['/auth/login', '/auth/register'];

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

/** Whether an answer refuses the session: 401 or 403. A 429, a 5xx or no answer (undefined) does not. */
export function isRefusalStatus(status: unknown): boolean {
  return status === 401 || status === 403;
}

/**
 * Whether a failed refresh means the session is over: the server answered and refused it (401, 403), or there
 * is no refresh token. A server error (5xx), a 429 or no answer at all (network, timeout) does not: the session
 * stays, the next request tries again (`refreshInFlight` is cleared once a refresh settles).
 */
export function isRefreshRefused(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return isRefusalStatus(error.response?.status);
  }
  // `No refresh token`: nothing to refresh with.
  return true;
}

/** The plain words a reader gets when a refresh could not reach the server. */
export const CONNECTION_FAILED_MESSAGE = 'Connessione al server non riuscita. La sessione resta aperta: riprova tra poco.';

/** A server's limit of requests (429). No time promised: the sign-in's limit blocks for 15 minutes, others for one. */
export const TOO_MANY_REQUESTS_MESSAGE = 'Troppe richieste in poco tempo. Riprova più tardi.';

/** The 429's words, with the wait the server gives in `Retry-After` (seconds) when it gives one. */
function tooManyRequestsMessage(retryAfter: unknown): string {
  const seconds = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(seconds) || seconds <= 0) return TOO_MANY_REQUESTS_MESSAGE;
  const minutes = Math.ceil(seconds / 60);
  return `Troppe richieste in poco tempo. Riprova tra ${minutes === 1 ? 'un minuto' : `${minutes} minuti`}.`;
}

/** No answer at all (network, timeout). */
export const NO_ANSWER_MESSAGE = 'Il server non risponde. Controlla la connessione e riprova.';

/** The server's English answers a reader can meet, in Italian; any other passes as the server wrote it. */
const SERVER_WORDS: Record<string, string> = {
  'Invalid credentials': 'Email o password non corrette.',
  'User with this email or username already exists': 'Esiste già un account con questa email o questo nome utente.',
  'Internal server error': 'Errore del server. Riprova tra poco.',
  'Not found': 'Non trovato.',
  'Authentication required': 'Accedi per continuare.',
  'Admin access required': 'Serve un account di amministrazione.',
};

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

    // If error is 401 and we haven't retried yet, try to refresh token. Not for the sign-in and the sign-up: their
    // 401 answers the credentials, and goes to the form as it is (LC14).
    if (error.response?.status === 401 && !originalRequest._retry && !CREDENTIAL_URLS.includes(originalRequest.url ?? '')) {
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
    const status = error.response?.status;
    return Promise.reject({
      status,
      // The server's limit answers in English, and axios's own words («Request failed with status code 500»,
      // «Network Error») are English too: the reader gets Italian, and what to do.
      message: status === 429
        ? tooManyRequestsMessage(error.response?.headers?.['retry-after'])
        : (responseData?.detail && (SERVER_WORDS[responseData.detail] ?? responseData.detail)) || (status ? `Richiesta non riuscita (errore ${status}). Riprova tra poco.` : NO_ANSWER_MESSAGE),
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
