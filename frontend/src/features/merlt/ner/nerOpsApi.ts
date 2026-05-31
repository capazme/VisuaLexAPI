import { getMerlt, postMerlt } from '../../../services/merltService';

/** Typed BFF clients for the admin NER ops surfaces (Loop β #2 Phase 4). */

export interface NerStats {
  total: number;
  untrained: number;
  by_type: Record<string, number>;
  by_surface: Record<string, number>;
}

export interface NerPrf {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface NerAbReport {
  test_examples: number;
  baseline: NerPrf | null;
  learned: NerPrf | null;
}

export interface NerTrainingResult {
  trained?: boolean;
  reason?: string;
  examples?: number;
  checkpoint_path?: string | null;
  final_loss?: number | null;
  ab_report?: NerAbReport;
}

export interface NerTrainingStart {
  task_id: string;
  status: string;
}

export interface NerTrainingStatus {
  task_id: string;
  status: string;
  result?: NerTrainingResult | null;
  error?: string;
}

export const TERMINAL_JOB_STATUSES = ['finished', 'failed', 'stopped', 'canceled'];

export function fetchNerStats(): Promise<NerStats> {
  return getMerlt<NerStats>('/merlt/ner/feedback/stats');
}

export function startNerTraining(nIter?: number): Promise<NerTrainingStart> {
  return postMerlt<NerTrainingStart>('/merlt/ner/training/start', nIter ? { nIter } : {});
}

export function fetchNerTrainingStatus(taskId: string): Promise<NerTrainingStatus> {
  return getMerlt<NerTrainingStatus>(`/merlt/ner/training/jobs/${encodeURIComponent(taskId)}`);
}
