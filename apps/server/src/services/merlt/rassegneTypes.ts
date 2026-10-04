// apps/server/src/services/merlt/rassegneTypes.ts
/**
 * MERL-T GET /api/v1/rassegne/by-norma, proxied verbatim (snake_case as MERL-T emits it):
 * the paragraphs of the Massimario's annual reviews that cite a norm, grouped by year.
 */
export interface RassegnaPronuncia {
  key: string | null;
  label: string;
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
}
