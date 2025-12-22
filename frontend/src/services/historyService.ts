/**
 * History Service - Manages user search history via the Node.js backend.
 */
import { get, post, del } from './api';

export interface SearchHistoryItem {
  id: string;
  act_type: string;
  act_number?: string;
  article?: string;
  date?: string;
  version?: string;
  created_at: string;
}

export interface AddHistoryData {
  act_type: string;
  act_number?: string;
  article?: string;
  date?: string;
  version?: string;
}

/**
 * Get user's search history
 */
export const getHistory = async (limit = 100, offset = 0): Promise<SearchHistoryItem[]> => {
  return get<SearchHistoryItem[]>('/history', { limit, offset });
};

/**
 * Add item to search history
 */
export const addToHistory = async (data: AddHistoryData): Promise<SearchHistoryItem> => {
  return post<SearchHistoryItem>('/history', data);
};

/**
 * Delete single history item
 */
export const deleteHistoryItem = async (id: string): Promise<void> => {
  await del(`/history/${id}`);
};

/**
 * Clear all user's search history
 */
export const clearHistory = async (): Promise<void> => {
  await del('/history');
};
