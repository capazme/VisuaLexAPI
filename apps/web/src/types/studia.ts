/** VisuaLex Studia: the study cards (`/api/lingo/cards`). The UI says «scheda»; the code keeps the API's names. */

export type Materia =
  | 'DIRITTO_CIVILE'
  | 'DIRITTO_PENALE'
  | 'DIRITTO_AMMINISTRATIVO'
  | 'DIRITTO_PROCESSUALE_CIVILE'
  | 'DIRITTO_PROCESSUALE_PENALE';
export type StatoScheda = 'BOZZA_PERSONALE' | 'PROPOSTA_COMMUNITY' | 'VALIDATA' | 'DA_RIVEDERE' | 'ARCHIVIATA';
export type TipoScheda = 'ISTITUTO_DEFINIZIONE' | 'DISTINZIONE_CONCETTUALE' | 'CASO_APPLICATIVO' | 'REQUISITO_FORMA_ATTO';

export interface AncoraScheda {
  normaKey: string;
  articleId: string;
  /** The official URN of the article, cut from the address the reader holds. */
  urn: string;
  isPrimary: boolean;
}

export interface Scheda {
  id: string;
  materia: Materia;
  istituto: string;
  tipo: TipoScheda;
  domanda: string;
  risposta: string;
  spiegazione: string | null;
  stato: StatoScheda;
  createdAt: string;
  updatedAt: string;
  ancore: AncoraScheda[];
  /** The connected application that wrote the card; null for a card written here. */
  origine: { clientName: string | null } | null;
}

/** A card in the reader's panel: the community's come with the validation (PR B). */
export interface SchedaDellArticolo extends Scheda {
  comunita: boolean;
  approvazioni: number | null;
}

/** What the form sends: anchors as references («art. 1453 c.c.»), which the server resolves and checks. */
export interface SchedaInput {
  materia: Materia;
  istituto: string;
  tipo: TipoScheda;
  domanda: string;
  risposta: string;
  spiegazione?: string;
  ancore: Array<{ riferimento: string; principale?: boolean }>;
}

export interface FiltriSchede {
  materia?: Materia;
  stato?: StatoScheda;
  tipo?: TipoScheda;
  /** Any anchor on this act (the norm key, e.g. `codice_civile`). */
  normaKey?: string;
  q?: string;
  origine?: 'applicazione';
  ordine?: 'recenti' | 'materia';
  limit?: number;
  offset?: number;
}

/** An anchor the server could not verify, with its words: shown on the chip that failed. */
export interface EsitoAncoraRifiutata {
  outcome: 'not_recognised' | 'does_not_exist' | 'ambiguous' | 'unavailable';
  reference: string;
  detail: string;
}

export interface EsitoRifiuto {
  outcome: 'refused';
  detail: string;
  anchors?: EsitoAncoraRifiutata[];
}

export type EsitoCreazione = { outcome: 'created'; id: string } | EsitoRifiuto;
export type EsitoModifica = { outcome: 'updated'; card: Scheda } | EsitoRifiuto;

/** What moving cards to the trash answers: the ids moved, and those that are not the user's or not deletable. */
export interface EsitoCestino {
  trashId?: string;
  moved: string[];
  notFound: string[];
  notDeletable: string[];
}
