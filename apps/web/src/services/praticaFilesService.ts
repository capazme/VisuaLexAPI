import { apiClient, NO_ANSWER_MESSAGE } from './api';
import { legalFetch } from './legalFetch';
import { attiError } from './attiService';

/**
 * A case's files and the instructions for Claude (LC50's routes under `/api/dossiers/:dossierId`, the user's session
 * only). The upload and the download go through `legalFetch`: axios drops multipart bodies (`contribApi.ts`), and a
 * blob answer would hide the server's `detail`. A failure travels as `services/api.ts` shapes it: `{ status, message }`.
 */
export interface PraticaFile {
  id: string;
  dossierId: string;
  nome: string;
  mime: string;
  peso: number;
  versione: number;
  versioneDi: string | null;
  autore: 'utente' | 'claude';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PraticaFileGroup extends PraticaFile {
  versioni: PraticaFile[];
}

export interface PraticaFiles {
  files: PraticaFileGroup[];
  cestino: PraticaFile[];
}

/** The server's ceilings (`routes/praticaFiles.ts`). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ISTRUZIONI = 20_000;
export const PRATICA_FILE_ACCEPT = '.pdf,.docx,.doc,.odt,.rtf,.txt,.jpg,.jpeg,.png';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const path = (dossierId: string, rest = '') => `/dossiers/${encodeURIComponent(dossierId)}${rest}`;
const filePath = (dossierId: string, fileId: string, rest = '') => path(dossierId, `/files/${encodeURIComponent(fileId)}${rest}`);

/** A `fetch` answer that is not ok, shaped as `api.ts` shapes axios's. */
async function refused(response: Response): Promise<{ status: number; message: string }> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === 'string' ? body.detail : '';
  return { status: response.status, message: detail || `Richiesta non riuscita (errore ${response.status}). Riprova tra poco.` };
}

async function send(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await legalFetch(`${API_BASE_URL}${url}`, { credentials: 'include', ...init });
  } catch {
    throw { status: undefined, message: NO_ANSWER_MESSAGE };
  }
  if (!response.ok) throw await refused(response);
  return response;
}

export const praticaFilesService = {
  async list(dossierId: string): Promise<PraticaFiles> {
    return (await apiClient.get(path(dossierId, '/files'))).data;
  },
  /** A new file, or with `versionOf` a new version of that file (the server files it under the original). */
  async upload(dossierId: string, file: File, versionOf?: string): Promise<PraticaFile> {
    const form = new FormData();
    form.append('file', file);
    const url = versionOf ? filePath(dossierId, versionOf, '/versions') : path(dossierId, '/files');
    return (await (await send(url, { method: 'POST', body: form })).json()).file;
  },
  async download(dossierId: string, fileId: string): Promise<Blob> {
    return (await send(filePath(dossierId, fileId, '/content'))).blob();
  },
  async trash(dossierId: string, fileId: string): Promise<void> {
    await apiClient.post(filePath(dossierId, fileId, '/trash'));
  },
  async restore(dossierId: string, fileId: string): Promise<void> {
    await apiClient.post(filePath(dossierId, fileId, '/restore'));
  },
  async remove(dossierId: string, fileId: string): Promise<void> {
    await apiClient.delete(filePath(dossierId, fileId));
  },
  async getIstruzioni(dossierId: string): Promise<string> {
    return (await apiClient.get(path(dossierId, '/istruzioni'))).data.istruzioni.testo;
  },
  async saveIstruzioni(dossierId: string, testo: string): Promise<void> {
    await apiClient.put(path(dossierId, '/istruzioni'), { testo });
  },
};

/** Without the server key every file route answers 503 (LC50); the instructions keep working. */
export const FILES_OFF_MESSAGE = 'I file della pratica non sono attivi su questo server.';

/** The routes' words, as the consultant asked them shown (the ceilings in the conditional, who to tell). */
const REWORDED: Record<string, string> = {
  'La pratica supera 500 MB di file (cestino compreso).': 'Con questo file la pratica supererebbe 500 MB (cestino compreso).',
  'Il tuo account supera 2 GB di file (cestino compreso).': 'Con questo file il tuo account supererebbe 2 GB.',
  'Il file non si può decifrare: la chiave del server è cambiata o il file è danneggiato.':
    'Il file non si può decifrare: la chiave del server è cambiata o il file è danneggiato. Avvisa chi gestisce LexCraft.',
};

export function praticaFilesError(error: unknown, fallback: string): string {
  if ((error as { status?: unknown } | null)?.status === 503) return FILES_OFF_MESSAGE;
  const message = attiError(error, fallback);
  return REWORDED[message] ?? message;
}
