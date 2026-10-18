import { apiClient } from './api';
import type { EnvironmentCategory, StudyImportReport } from '../types';

// Wire shape for a personal environment as returned by the backend.
// Matches `environmentController.serialize` in the backend.
export interface EnvironmentApi {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  version: string | null;
  category: EnvironmentCategory | null;
  color: string | null;
  tags: string[];
  // Opaque blob: dossiers / quickNorms / customAliases / annotations /
  // highlights. The store owns the schema (`Environment` in types/index.ts)
  // and hydrates the whole thing on read.
  content: unknown;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentCreatePayload {
  name: string;
  description?: string | null;
  author?: string | null;
  version?: string | null;
  category?: EnvironmentCategory | null;
  color?: string | null;
  tags?: string[];
  content: unknown;
}

export interface EnvironmentUpdatePayload {
  name?: string;
  description?: string | null;
  author?: string | null;
  version?: string | null;
  category?: EnvironmentCategory | null;
  color?: string | null;
  tags?: string[];
  content?: unknown;
}

export const environmentService = {
  /** «Recupera i dossier»: an archived environment's dossiers become study dossiers (spec D11b). */
  async recover(id: string, switches: { addNotes: boolean; addHighlights: boolean } = { addNotes: true, addHighlights: true }): Promise<StudyImportReport> {
    const response = await apiClient.post(`/environments/${id}/recover`, switches);
    return response.data;
  },

  async getAll(): Promise<EnvironmentApi[]> {
    const response = await apiClient.get('/environments');
    return response.data;
  },

  async getById(id: string): Promise<EnvironmentApi> {
    const response = await apiClient.get(`/environments/${id}`);
    return response.data;
  },

  async create(data: EnvironmentCreatePayload): Promise<EnvironmentApi> {
    const response = await apiClient.post('/environments', data);
    return response.data;
  },

  async update(id: string, data: EnvironmentUpdatePayload): Promise<EnvironmentApi> {
    const response = await apiClient.put(`/environments/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/environments/${id}`);
  },
};
