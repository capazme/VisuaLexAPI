import { apiClient } from './api';

export const accountService = {
  async exportData(): Promise<unknown> {
    const response = await apiClient.get('/auth/export');
    return response.data;
  },
  async deleteAccount(password: string, confirmation: string): Promise<void> {
    await apiClient.delete('/auth/account', { data: { password, confirmation } });
  },
};
