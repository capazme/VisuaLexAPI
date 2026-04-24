import { apiClient } from './api';
import type { AliasType } from '../types';

export interface CustomAliasApi {
  id: string;
  trigger: string;
  type: AliasType;
  expandTo: string;
  searchParams: {
    act_type: string;
    act_number?: string;
    date?: string;
    article?: string;
  } | null;
  description: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CustomAliasCreatePayload {
  trigger: string;
  type: AliasType;
  expandTo: string;
  searchParams?: CustomAliasApi['searchParams'];
  description?: string | null;
}

export interface CustomAliasUpdatePayload {
  trigger?: string;
  type?: AliasType;
  expandTo?: string;
  searchParams?: CustomAliasApi['searchParams'];
  description?: string | null;
  usageCount?: number;
  lastUsedAt?: string | null;
}

export const customAliasService = {
  async getAll(): Promise<CustomAliasApi[]> {
    const response = await apiClient.get('/custom-aliases');
    return response.data;
  },

  async create(data: CustomAliasCreatePayload): Promise<CustomAliasApi> {
    const response = await apiClient.post('/custom-aliases', data);
    return response.data;
  },

  async update(id: string, data: CustomAliasUpdatePayload): Promise<CustomAliasApi> {
    const response = await apiClient.put(`/custom-aliases/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/custom-aliases/${id}`);
  },

  // Atomic usage bump, fired by resolveAlias / alias-driven search.
  async use(id: string): Promise<CustomAliasApi> {
    const response = await apiClient.post(`/custom-aliases/${id}/use`);
    return response.data;
  },
};
