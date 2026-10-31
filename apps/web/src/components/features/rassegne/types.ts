/**
 * The Massimario's review paragraphs citing a norm: mirrors the Python API's `/fetch_rassegne`
 * (`services/visualex/visualex_api/services/massimario/store.py`, `_item`), snake_case verbatim —
 * never invent camelCase fields. A decision carries no label: the web writes it from the fields
 * (`formatDecisionShort`).
 */
export interface RassegnaPronuncia {
  key: string | null;
  corte: string;
  archivio: string | null;
  numero: number;
  anno: number | null;
  sezione: string | null;
  rv: string[];
}

export interface RassegnaEvidenziazione {
  start: number;
  end: number;
  citazione: string;
  comma: string | null;
}

export interface RassegnePasso {
  id: string;
  anno: number;
  archivio: string;
  volume: { id: number; numero: number | null; titolo: string };
  parte: { nome: string; titolo: string } | null;
  capitolo: { nome: string; titolo: string } | null;
  sezione: { id: number; numero: string; titolo: string };
  autori: string[];
  url: string;
  testo: string;
  evidenziazioni: RassegnaEvidenziazione[];
  pronunce: RassegnaPronuncia[];
  fonte: string;
}

export interface RassegneResponse {
  urn: string;
  total: number;
  anni: { anno: number; passi: number }[];
  archivi: string[];
  anno: number | null;
  items: RassegnePasso[];
  next_cursor: string | null;
}

export interface RassegneQuery {
  urn: string;
  anno?: number;
  archivio?: 'civile' | 'penale';
  cursor?: string;
  /** the words to search for (`searchWords`), joined by spaces; sent in the body, never in an address */
  q?: string;
}
