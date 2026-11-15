import { apiClient } from './api';

/**
 * The acts (`/api/atti`, the user's session only). The server answers Prisma's rows as they are (camelCase). An act's
 * text may name a client: nothing here logs one, and a failure travels as `services/api.ts` shapes it.
 */
export type AttoStato = 'bozza' | 'finale';

export interface AttoSummary {
  id: string;
  titolo: string;
  tipo: string | null;
  stato: AttoStato;
  dossierId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Atto extends AttoSummary {
  testo: string;
}

export interface AttoCreate {
  titolo: string;
  tipo?: string | null;
  testo?: string;
  dossierId?: string | null;
}

export type AttoUpdate = Partial<Pick<Atto, 'titolo' | 'tipo' | 'testo' | 'stato' | 'dossierId'>>;

/** The kinds offered as suggestions; any other is accepted (the list is an open question for the backend). */
export const ATTO_TIPI = ['Atto di citazione', 'Comparsa di costituzione e risposta', 'Memoria', 'Atto di appello', 'Ricorso', 'Diffida', 'Parere'] as const;

/** The longest text the server keeps (`routes/atti.ts`, `MAX_TESTO`). */
export const MAX_TESTO = 500_000;

export const attiService = {
  async list(dossierId?: string): Promise<AttoSummary[]> {
    const response = await apiClient.get('/atti', { params: dossierId ? { dossierId } : undefined });
    return response.data.atti;
  },
  async get(id: string): Promise<Atto> {
    return (await apiClient.get(`/atti/${encodeURIComponent(id)}`)).data.atto;
  },
  async create(input: AttoCreate): Promise<Atto> {
    return (await apiClient.post('/atti', input)).data.atto;
  },
  async update(id: string, input: AttoUpdate): Promise<Atto> {
    return (await apiClient.put(`/atti/${encodeURIComponent(id)}`, input)).data.atto;
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/atti/${encodeURIComponent(id)}`);
  },
};

/** The server's Italian message of a failed call, or a plain one. */
export function attiError(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
