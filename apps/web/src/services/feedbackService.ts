/**
 * Feedback service for submitting bug reports and suggestions
 */
import { post } from './api';

export type FeedbackType = 'bug' | 'suggestion' | 'other';

export interface FeedbackData {
  type: FeedbackType;
  message: string;
}

export interface FeedbackResponse {
  id: string;
  type: FeedbackType;
  message: string;
  status: string;
  created_at: string;
}

/**
 * Submit feedback (bug report or suggestion)
 */
export const submitFeedback = async (data: FeedbackData): Promise<FeedbackResponse> => {
  return post<FeedbackResponse>('/feedback', data);
};
