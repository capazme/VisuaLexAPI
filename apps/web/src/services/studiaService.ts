import { apiClient } from './api';
import type {
  EsitoCestino,
  EsitoCreazione,
  EsitoModifica,
  EsitoProposta,
  FiltriSchede,
  Giudizio,
  Materia,
  StatoScheda,
  Scheda,
  SchedaDellArticolo,
  SchedaInput,
  TestoCorrente,
  TestoDaAccettare,
} from '../types/studia';

/**
 * VisuaLex Studia's cards (`/api/lingo/cards`, `/api/lingo/articolo`). The anchors are given as
 * references and checked by the server: a card that cannot be anchored is a refusal with the
 * reason, not an error. The cards are server state, fetched per view.
 */

/** What an apiClient rejection looks like (`services/api.ts`). */
interface ApiRejection {
  status?: number;
  data?: { detail?: unknown; anchors?: unknown; richiedeTesto?: unknown };
}

export const studiaService = {
  async list(filtri: FiltriSchede = {}): Promise<{ cards: Scheda[]; nextOffset: number | null }> {
    // An unset or empty filter is no filter: it never reaches the query string.
    const params = Object.fromEntries(Object.entries(filtri).filter(([, value]) => value !== undefined && value !== ''));
    const response = await apiClient.get('/lingo/cards', { params });
    return response.data;
  },

  async get(id: string): Promise<Scheda> {
    const response = await apiClient.get(`/lingo/cards/${encodeURIComponent(id)}`);
    return response.data;
  },

  /** One card as a call of one: its own outcome, `created` with the id or `refused` with the anchors that failed. */
  async create(input: SchedaInput): Promise<EsitoCreazione> {
    const response = await apiClient.post('/lingo/cards', { cards: [input] });
    return response.data.results[0];
  },

  /**
   * Edits a draft. A 400 is a refusal (an anchor that cannot be verified, a field out of its
   * limits); 404 (not found), 409 (no longer a draft) and 503 (sources down) reject as they come.
   */
  async update(id: string, input: SchedaInput): Promise<EsitoModifica> {
    try {
      const response = await apiClient.patch(`/lingo/cards/${encodeURIComponent(id)}`, input);
      return { outcome: 'updated', card: response.data };
    } catch (error) {
      const rejection = error as ApiRejection;
      if (rejection.status === 400 && typeof rejection.data?.detail === 'string') {
        const anchors = Array.isArray(rejection.data.anchors) ? rejection.data.anchors : undefined;
        return { outcome: 'refused', detail: rejection.data.detail, ...(anchors ? { anchors } : {}) };
      }
      throw error;
    }
  },

  /** Drafts and archived cards go to the trash for 30 days; the answer says which moved. */
  async trash(ids: string[]): Promise<EsitoCestino> {
    const response = await apiClient.post('/lingo/cards/trash', { cardIds: ids });
    return response.data;
  },

  /**
   * Proposes a draft to the community. A 409 that carries `richiedeTesto` is not a failure: the
   * server wants the current notice accepted first, and sends it. Pass the accepted version's id to
   * propose under it. 404, and a 409 without a notice (no longer a draft), reject as they come.
   */
  async propose(id: string, accettoTestoId?: string): Promise<EsitoProposta> {
    try {
      const response = await apiClient.post(`/lingo/cards/${encodeURIComponent(id)}/proponi`, accettoTestoId ? { accettoTestoId } : {});
      return response.data;
    } catch (error) {
      const rejection = error as ApiRejection;
      if (rejection.status === 409 && rejection.data?.richiedeTesto && typeof rejection.data.richiedeTesto === 'object') {
        return { richiedeTesto: rejection.data.richiedeTesto as TestoDaAccettare };
      }
      throw error;
    }
  },

  /** Takes a proposal back: the card is a draft again and its votes are gone. */
  async withdraw(id: string): Promise<Scheda> {
    const response = await apiClient.post(`/lingo/cards/${encodeURIComponent(id)}/ritira`);
    return response.data;
  },

  /** The current version of a text to accept, by key, and whether this user has accepted it. */
  async text(chiave: string): Promise<TestoCorrente> {
    const response = await apiClient.get(`/lingo/testi/${encodeURIComponent(chiave)}`);
    return response.data;
  },

  /**
   * The proposed cards this validator may judge, oldest first: not their own, not yet voted. A 403
   * rejects when the user is not (or no longer) a validator.
   */
  async queue({ materia, limit }: { materia?: Materia; limit?: number } = {}): Promise<{ cards: Scheda[] }> {
    const params = Object.fromEntries(Object.entries({ materia, limit }).filter(([, value]) => value !== undefined));
    const response = await apiClient.get('/lingo/validazione/coda', { params });
    return response.data;
  },

  /**
   * One vote on a proposed card; the reason is required unless the verdict is `APPROVATA`. Answers the
   * card's state after the vote. 403 (no longer a validator), 404 (no longer proposed) and 409
   * (already voted) reject as they come.
   */
  async vote(cardId: string, giudizio: Giudizio, motivazione?: string): Promise<{ stato: StatoScheda }> {
    const response = await apiClient.post(`/lingo/validazione/${encodeURIComponent(cardId)}`, motivazione === undefined ? { giudizio } : { giudizio, motivazione });
    return response.data;
  },

  /** The cards resting on an article, by the address the reader holds. */
  async forArticle(urn: string): Promise<SchedaDellArticolo[]> {
    const response = await apiClient.get('/lingo/articolo', { params: { urn } });
    return response.data.cards;
  },
};
