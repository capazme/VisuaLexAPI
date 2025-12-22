/**
 * Centralized API client using axios with interceptors for authentication and error handling.
 */
import axios from 'axios';
import type { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

// API base URL - uses relative path to leverage Vite proxy in development
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor to add authentication token to headers
 */
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('access_token');

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
        const refreshToken = localStorage.getItem('refresh_token');

        if (!refreshToken) {
          // No refresh token, redirect to login
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
          return Promise.reject(error);
        }

        // Attempt to refresh the access token
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token } = response.data;

        // Store new tokens
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('refresh_token', refresh_token);

        // Retry original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
        }

        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed, clear tokens and redirect to login
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
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
export const get = async <T = any>(url: string, params?: any): Promise<T> => {
  const response = await apiClient.get<T>(url, { params });
  return response.data;
};

/**
 * Generic POST request
 */
export const post = async <T = any>(url: string, data?: any): Promise<T> => {
  const response = await apiClient.post<T>(url, data);
  return response.data;
};

/**
 * Generic PUT request
 */
export const put = async <T = any>(url: string, data?: any): Promise<T> => {
  const response = await apiClient.put<T>(url, data);
  return response.data;
};

/**
 * Generic PATCH request
 */
export const patch = async <T = any>(url: string, data?: any): Promise<T> => {
  const response = await apiClient.patch<T>(url, data);
  return response.data;
};

/**
 * Generic DELETE request
 */
export const del = async <T = any>(url: string): Promise<T> => {
  const response = await apiClient.delete<T>(url);
  return response.data;
};

// Export as both named and default for flexibility
export { apiClient };
export default apiClient;
