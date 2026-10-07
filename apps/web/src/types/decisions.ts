/** Court decisions (design docs/superpowers/specs/2026-10-01-sentenze-design.md), as
 *  POST /fetch_decision answers them (docs/backend/python_api_reference.md). */
export type DecisionCourt = 'cassazione' | 'corte_costituzionale';
export type DecisionArchive = 'civile' | 'penale';

/** What VisuaLex resolved: unique. `archivio` is always set for the Cassazione. */
export interface DecisionIdentity {
  corte: DecisionCourt;
  numero: number;
  anno: number;
  archivio?: DecisionArchive;
}

/** What a citation says: it may lack the archive and carry a section as written. */
export interface DecisionReference extends DecisionIdentity {
  sezione?: string;
}

/** The particulars the source has, and only those. */
export interface DecisionAttributes {
  sezione?: string;
  tipo?: string;
  data_deposito?: string;
  data_decisione?: string;
  ecli?: string;
  relatore?: string;
  presidente?: string;
  materia?: string;
  /** Why there is no text, only when the source said why: `oscuramento` or `valutazione_oscuramento`. */
  testo_assente?: string;
  /** Where the Cassazione's text was read: the court's original PDF, or Italgiure's text field (provisional, with the notice `testo_da_archivio`). */
  testo_origine?: 'pdf' | 'archivio';
}

/** The blocks, each whole and each optional; `{}` when the decision comes without its text
 *  (notice `testo_non_disponibile`). A Corte costituzionale epigrafe that holds the reasoning
 *  comes split at its «Ritenuto»/«Considerato» line, or whole when it has none. */
export interface DecisionText {
  epigrafe?: string;
  motivazione?: string;
  dispositivo?: string;
}

/** `licenza` and `url` come with the Corte costituzionale only: `url` is the court's own page
 *  for the decision, opened by the reader's browser. */
export interface DecisionSource {
  nome: string;
  licenza?: string;
  url?: string;
}

/** `citata` is the section as cited, sent only when it is a short plain form. */
export type DecisionNotice =
  | { tipo: 'sezione_diversa'; citata?: string; effettiva: string }
  | { tipo: 'sezione_non_riconosciuta'; citata?: string }
  | { tipo: 'archivio_dedotto'; archivio: DecisionArchive; sezione: string }
  | { tipo: 'testo_non_disponibile' }
  | { tipo: 'testo_da_archivio' };

export interface DecisionCandidate {
  identita: DecisionIdentity;
  attributi: DecisionAttributes;
}

export interface FoundDecision {
  esito: 'trovata';
  identita: DecisionIdentity;
  attributi: DecisionAttributes;
  testo: DecisionText;
  fonte: DecisionSource;
  avvisi: DecisionNotice[];
}

/** `archivio_dal` can be missing, `anno_parziale` included: the archive's start is not always known. */
export type NotFoundDecision = {
  esito: 'non_trovata';
  motivo: 'inesistente' | 'fuori_archivio' | 'anno_parziale';
  archivio_dal?: string;
  suggerimento?: DecisionIdentity;
};

/** The six answers the route's handler writes. The `fonte` of `fonte_non_raggiungibile` is
 *  `cassazione` or `corte_costituzionale` from the route; the web app adds `quota`, `rete` and
 *  `risposta <status>` for what never reached the route or was not its answer. */
export type FetchDecisionAnswer =
  | FoundDecision
  | { esito: 'ambigua'; candidati: DecisionCandidate[] }
  | NotFoundDecision
  | { esito: 'fonte_non_raggiungibile'; fonte: string }
  | { esito: 'richiesta_non_valida'; errori: Record<string, string> }
  | { esito: 'errore_interno' };

/** A decision kept in a dossier: its identity and what the row shows, never its text. */
export interface DossierSentenzaData extends DecisionIdentity {
  sezione?: string;
  tipo?: string;
  data_deposito?: string;
  etichetta: string;
}
