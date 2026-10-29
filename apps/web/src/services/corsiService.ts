import { apiClient } from './api';
import type { Chiave, CorsoCestinato, CorsoDiOggi, CorsoInLista, CorsoPagina, EsitoRisposta, ModuloLezione } from '../types/corsi';
import type { TestoCorrente, TestoDaAccettare } from '../types/studia';

/**
 * Gymnasium's courses, «Percorsi» (`/api/lingo/corsi`, spec 2026-10-23 §10.5): the session's routes the web needs. A
 * course is created by the user's assistant, never here: the web lists, reads, renames, trims the programme, trashes and
 * exports. Behind the switch `lingo_courses`: off, every route answers 404 (`isCoursesOff`).
 */

const course = (id: string) => `/lingo/corsi/${encodeURIComponent(id)}`;
const courseModule = (id: string, moduloId: string) => `${course(id)}/moduli/${encodeURIComponent(moduloId)}`;
const DECLARATION = '/lingo/testi/MATERIALE_STUDIO';

/** What an apiClient rejection looks like (`services/api.ts`). */
interface ApiRejection {
  status?: number;
  data?: { detail?: unknown; richiedeTesto?: unknown };
}

/** The server's Italian reason, or the fallback. */
export function corsiErrorDetail(error: unknown, fallback: string): string {
  const detail = (error as ApiRejection | null)?.data?.detail;
  return typeof detail === 'string' && detail ? detail : fallback;
}

/** A 404: the course is not the caller's (or gone), or the whole feature is switched off. */
export const isNotFound = (error: unknown) => (error as ApiRejection | null)?.status === 404;

/** No answer at all: the browser is offline or the server unreachable (`apiClient` gives no status then). */
export const isUnreachable = (error: unknown) => {
  const status = (error as ApiRejection | null)?.status;
  return status === undefined || status === 0;
};

/** Accepting the declaration answers it accepted, or the newer version to read first (409 with `richiedeTesto`). */
export type EsitoDichiarazione = { accettata: TestoCorrente } | { richiedeTesto: TestoDaAccettare };

export const corsiService = {
  /** The caller's courses, newest first. */
  async list(): Promise<CorsoInLista[]> {
    const response = await apiClient.get('/lingo/corsi');
    return response.data;
  },

  /** «Oggi»'s row: per course, the module to suggest and the due cards. */
  async today(): Promise<CorsoDiOggi[]> {
    const response = await apiClient.get('/lingo/corsi/oggi');
    return response.data;
  },

  async get(id: string): Promise<CorsoPagina> {
    const response = await apiClient.get(course(id));
    return response.data;
  },

  async rename(id: string, titolo: string): Promise<{ id: string; titolo: string; moduliPrevisti: number }> {
    const response = await apiClient.patch(course(id), { titolo });
    return response.data;
  },

  /** «Il programma finisce qui»: lowers the planned modules (never raises them, never under the counting ones). */
  async endProgrammeAt(id: string, moduliPrevisti: number): Promise<{ id: string; titolo: string; moduliPrevisti: number }> {
    const response = await apiClient.patch(course(id), { moduliPrevisti });
    return response.data;
  },

  /** To the trash: `trashId` is what «Annulla» restores; the dossier stays where it is. */
  async trash(id: string): Promise<CorsoCestinato> {
    const response = await apiClient.delete(course(id));
    return response.data;
  },

  /** A module never opened, to the trash (409 once opened). */
  async trashModule(id: string, moduloId: string): Promise<{ trashId: string }> {
    const response = await apiClient.delete(courseModule(id, moduloId));
    return response.data;
  },

  /** «Ritira questo modulo»: only once a live correction supersedes it (409 otherwise). */
  async withdrawModule(id: string, moduloId: string): Promise<void> {
    await apiClient.post(`${courseModule(id, moduloId)}/ritira`);
  },

  /**
   * A module's lesson and its recall questions (S2), the caller's outcomes with them: a module not yet opened is
   * readable too, and reading it opens nothing (§6.4).
   */
  async module(id: string, moduloId: string): Promise<ModuloLezione> {
    const response = await apiClient.get(courseModule(id, moduloId));
    return response.data;
  },

  /** Starts a module: from now it is frozen, never trashed, only withdrawn (§10.5). Idempotent. */
  async openModule(id: string, moduloId: string): Promise<void> {
    await apiClient.post(`${courseModule(id, moduloId)}/apri`);
  },

  /**
   * One choice on one item: the server grades it (§4: the web never says «right» or «wrong»). Only the item and the key
   * travel: the free recall, the highlights and the step reached never leave the browser (§8).
   */
  async answer(id: string, moduloId: string, domandaId: string, scelta: Chiave): Promise<EsitoRisposta> {
    const response = await apiClient.post(`${courseModule(id, moduloId)}/risposte`, { domandaId, scelta });
    return response.data;
  },

  /** One course as the account's export carries it. */
  async export(id: string): Promise<unknown> {
    const response = await apiClient.get(`${course(id)}/export`);
    return response.data;
  },

  /** The declaration on one's study material (§12): its current version and whether this user accepted it. */
  async declaration(): Promise<TestoCorrente> {
    const response = await apiClient.get(DECLARATION);
    return response.data;
  },

  async acceptDeclaration(testoId: string): Promise<EsitoDichiarazione> {
    try {
      const response = await apiClient.post(`${DECLARATION}/accetta`, { testoId });
      return { accettata: response.data };
    } catch (error) {
      const rejection = error as ApiRejection;
      if (rejection.status === 409 && rejection.data?.richiedeTesto && typeof rejection.data.richiedeTesto === 'object') {
        return { richiedeTesto: rejection.data.richiedeTesto as TestoDaAccettare };
      }
      throw error;
    }
  },
};
