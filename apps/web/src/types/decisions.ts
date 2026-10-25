import type { NormaVisitata } from './index';

/** Court decisions (design docs/superpowers/specs/2026-10-01-sentenze-design.md), as
 *  POST /fetch_decision answers them (docs/backend/python_api_reference.md). */
/** The courts of the Union are named by their case (design 2026-10-12 §3.1): `numero` and `anno`
 *  are the case's (C-634/21 → 634, 2021). */
/** The administrative courts are named by kind, number and year, a TAR by its seat too (design
 *  2026-10-12-administrative-courts §2). */
export type DecisionCourt =
  | 'cassazione' | 'corte_costituzionale' | 'corte_giustizia_ue' | 'tribunale_ue' | 'consiglio_di_stato' | 'cgars' | 'tar';
export type DecisionArchive = 'civile' | 'penale';

/** What VisuaLex resolved: unique. `archivio` is always set for the Cassazione. */
export interface DecisionIdentity {
  corte: DecisionCourt;
  numero: number;
  anno: number;
  archivio?: DecisionArchive;
  /** The administrative courts: a TAR's seat (`roma`, one of tar-seats.json), the kind of measure
   *  (`sent`, `ocau`: the ECLI's suffix in lower case). */
  sede?: string;
  provvedimento?: string;
}

/** What a citation says: it may lack the archive and carry a section as written. */
export interface DecisionReference extends DecisionIdentity {
  sezione?: string;
  /** A TAR named by its region alone (D3): the route searches its seats. */
  regione?: string;
  /** The family the words name (`sentenza`, `ordinanza`, `decreto`) when they name no kind. */
  tipo?: string;
}

/** The norm a decision search is anchored to: the four fields `/search_decisions` reads
 *  (`NORMA_FIELDS` in search_route.py); any other field of an article is ignored there. */
export type DecisionSearchNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_articolo'> & Partial<Pick<NormaVisitata, 'numero_atto' | 'data'>>;

/** What a decision-search tab asks for: decisions citing a norm, matching a text, or both. */
export interface DecisionSearchQuery {
  norma?: DecisionSearchNorma;
  normaLabel?: string;
  tema?: string;
  archivio?: DecisionArchive;
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
  /** The courts of the Union: the parties as the source names them, the joined cases («C-293/12»), the procedure language. */
  parti?: string;
  cause_riunite?: string[];
  lingua_processuale?: string;
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
  | { tipo: 'testo_da_archivio' }
  /** A joined case: the judgment is filed under the first case, whose number and year these are. */
  | { tipo: 'causa_riunita'; numero: string; anno: string }
  /** A TAR named by its region alone: the seat the route read it at (D3). */
  | { tipo: 'sede_dedotta'; sede: string };

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

/** One decision of a search page. `trovata` says how it was found: cited in the Cassazione's
 *  index, or mentioned in its text. The `evidenziati` ranges count Python code points. */
export interface DecisionSearchHit {
  identita: DecisionIdentity;
  attributi: DecisionAttributes;
  trovata: 'indice' | 'testo';
  frammento: { testo: string; evidenziati: Array<[number, number]> } | null;
}

/** The five answers `/search_decisions` writes (search_route.py); `fonte` is also `quota`, `rete`
 *  or `risposta <status>` when the web app made it up. */
export type SearchDecisionsAnswer =
  | {
      esito: 'risultati';
      totale: number;
      pagina: number;
      modo: 'indice' | 'testo';
      archivio: DecisionArchive | null;
      archivio_dal: string | null;
      /** The matches per decision year, newest first, over every year whatever the range; absent when
       *  the archive sent no counts. In index mode they count like `totale`, before the citation re-check. */
      anni?: Array<{ anno: number; n: number }>;
      decisioni: DecisionSearchHit[];
    }
  | { esito: 'non_supportata' }
  | { esito: 'richiesta_non_valida'; errori: Record<string, string> }
  | { esito: 'fonte_non_raggiungibile'; fonte: string }
  | { esito: 'errore_interno' };

/** The years a search keeps (deposit years); one bound alone is an open range. */
export interface DecisionSearchYears {
  dal?: number;
  al?: number;
}

/** A decision kept in a dossier: its identity and what the row shows, never its text. */
export interface DossierSentenzaData extends DecisionIdentity {
  sezione?: string;
  tipo?: string;
  data_deposito?: string;
  /** The courts of the Union: the day the judgment was delivered, and the joined cases. */
  data_decisione?: string;
  cause_riunite?: string[];
  etichetta: string;
}

/** One decision of the Union's courts that cites an article (`/search_eu_case_law`, eu_case_law.py):
 *  `identita` is the shape `/fetch_decision` takes, `celex` the decision's own, `data` null when the
 *  source gave none. Only a judgment opens with the CGUE reader; an order or an opinion opens on EUR-Lex. */
export interface EuCaseLawDecision {
  corte: 'corte_giustizia_ue' | 'tribunale_ue';
  causa: string;
  ecli: string | null;
  data: string | null;
  tipo: 'JUDG' | 'ORDER' | 'OPIN_AG';
  celex: string;
  identita: DecisionIdentity;
}

/** The answers `/search_eu_case_law` writes; `fonte` is also `quota`, `rete` or `risposta <status>` when the web app made it up. */
export type EuCaseLawAnswer =
  | { esito: 'risultati'; celex: string; articolo: string; totale: number; troncato: boolean; decisioni: EuCaseLawDecision[] }
  | { esito: 'non_supportata' }
  | { esito: 'richiesta_non_valida'; errori: Record<string, string> }
  | { esito: 'fonte_non_raggiungibile'; fonte: string }
  | { esito: 'errore_interno' };

/** How a massima names an article: a provision at issue (`norma`) or what one was measured against (`parametro`). */
export type CorteCostRuolo = 'norma' | 'parametro';

/** A massima of the Corte costituzionale's open data, as `/search_corte_cost_massime` gives it: the text verbatim. */
export interface CorteCostMassima {
  /** The Court's number of the massima. */
  numero: string;
  /** The Court's chain of classification headings. */
  titolo: string;
  testo: string;
  /** How the massima names the article: a provision at issue (`norma`), a parameter (`parametro`), or both. */
  ruoli: CorteCostRuolo[];
  pronuncia: {
    identita: { corte: 'corte_costituzionale'; numero: number; anno: number };
    tipo: 'sentenza' | 'ordinanza' | null;
    data_decisione: string | null;
    data_deposito: string | null;
    /** The decision's page on the Court's site. */
    url: string;
  };
}

export type CorteCostMassimeAnswer =
  | {
      esito: 'risultati'; urn: string; pagina: number; per_pagina: number;
      /** The massime the list holds: in the role asked (`ruolo`), else in any. */
      totale: number; ruolo?: CorteCostRuolo | null;
      per_ruolo: { norma: number; parametro: number }; massime: CorteCostMassima[];
      fonte: { nome: string; licenza: string; url: string }; attribuzione: string; aggiornato_al: string | null;
    }
  | { esito: 'richiesta_non_valida'; errori: Record<string, string> }
  | { esito: 'fonte_non_raggiungibile'; fonte: string; in_preparazione?: boolean }
  | { esito: 'errore_interno' };
