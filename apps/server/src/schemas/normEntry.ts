/**
 * A norm as a Forum proposal carries it (`articleRef`, the web's `NormaVisitata`), rebuilt from
 * known fields in closed forms. A proposal is someone else's data: its norm becomes a dossier
 * item whose citation (`norms/citation.ts`) the owner reads on the web, in the MCP reads and in
 * the MCP deletion dialog. A type the convention's tables do not know is written there in full,
 * so the type must be one they know, and every field a citation reads one of its fixed forms (an
 * article's suffix is a printed ordinal, an annex a number, a Roman numeral or a letter): no word
 * a proposer chose reaches a citation. The source addresses are kept only when they are
 * Normattiva's or EUR-Lex's; unknown keys are dropped.
 */
import { ACT_TYPES, CODES_TABLE, EU_ACTS, NAMED_ACTS } from '../norms/actTypes';
import { ARTICLE_SUFFIX_ALTERNATION } from '../utils/articleSuffixes';

export interface NormEntry {
  tipo_atto: string;
  numero_articolo: string;
  tipo_atto_reale?: string;
  numero_atto?: string;
  data?: string;
  allegato?: string;
  versione?: 'vigente' | 'originale';
  data_versione?: string;
  url?: string;
  urn?: string;
}

const key = (value: string): string => value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/** The types the citation names from a table, never in a proposer's words. */
const KNOWN_TYPES: ReadonlySet<string> = new Set(
  [...Object.keys(NAMED_ACTS), ...Object.keys(EU_ACTS), ...Object.keys(ACT_TYPES), ...Object.keys(CODES_TABLE)].map(key),
);

const ISO_DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
// The ordinals the courts print ("bis" … "vicies semel"), and "sex" of the compound "sex-decies":
// an article's suffix is one of them, never a word a proposer chose.
const ORDINAL = `(?:${ARTICLE_SUFFIX_ALTERNATION}|sex)`;
// An annex: a number, a Roman numeral or a single letter, in up to three parts ("I.1", "A", "2-A").
const ANNEX_PART = '(?:\\d{1,3}|[IVXLC]{1,6}|[A-Z])';
const PATTERNS = {
  numero_atto: /^\d{1,6}(?:[a-z]|bis|ter)?$/i,
  data: /^\d{4}(?:-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))?$/,
  // "2", "2-bis", "2043 bis", "270-bis.1", "135-sex-decies", "2409octiesdecies", "8a", "314/2"
  numero_articolo: new RegExp(`^\\d{1,5}(?:[- ]?${ORDINAL}){0,2}(?:[- ]?[a-z])?(?:[./]\\d{1,3})?$`, 'i'),
  allegato: new RegExp(`^${ANNEX_PART}(?:[.-]${ANNEX_PART}){0,2}$`, 'i'),
};
const URN = /^urn:nir:[\w.:;~!@=-]{1,400}$/i;
const SOURCE_HOSTS = new Set(['www.normattiva.it', 'normattiva.it', 'eur-lex.europa.eu']);

/** A value as text: a number is read as its digits (an act number can travel as one). */
function textOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  return typeof value === 'string' ? value.trim() : null;
}

/** A field that is present but not text (an object, a fraction, a boolean): never read as absent. */
const wrongType = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '' && textOf(value) === null;

function sourceUrl(value: unknown): string | null {
  const raw = textOf(value);
  if (!raw || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && SOURCE_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

export type NormEntryCheck = { ok: true; entry: NormEntry } | { ok: false; reason: string };

/** What a refusal says of a value: short, quoted, never the whole of what was sent. */
const shown = (value: string): string => `«${value.length > 40 ? `${value.slice(0, 40)}…` : value}»`;

const FIELD_REASONS = {
  numero_atto: "Numero dell'atto non valido",
  data: "Data dell'atto non valida (anno, oppure anno-mese-giorno)",
  allegato: 'Allegato non valido',
} as const;

/**
 * The norm a proposal names, rebuilt; a refusal says which field is not accepted and why, in
 * Italian, for the person who sent it. An optional field that is empty is left out; one that is
 * malformed refuses the norm, never quietly becomes another norm.
 */
export function rebuildNormEntry(raw: unknown): NormEntryCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'Norma non leggibile' };
  const r = raw as Record<string, unknown>;
  const FIELDS = ['tipo_atto', 'tipo_atto_reale', 'numero_articolo', 'numero_atto', 'data', 'allegato', 'versione', 'data_versione'] as const;
  const mistyped = FIELDS.find((field) => wrongType(r[field]));
  if (mistyped) return { ok: false, reason: `Campo «${mistyped}» non valido: deve essere un testo` };

  // The type as the tables spell it apart from spacing: no tab, line break or other blank survives into a title.
  const tipo = textOf(r.tipo_atto)?.split(/\s+/).join(' ') ?? null;
  if (!tipo) return { ok: false, reason: 'Tipo di atto mancante' };
  if (tipo.length > 200 || !KNOWN_TYPES.has(key(tipo))) return { ok: false, reason: `Tipo di atto non riconosciuto (${shown(tipo)})` };
  const articolo = textOf(r.numero_articolo);
  if (!articolo) return { ok: false, reason: 'Numero di articolo mancante' };
  if (!PATTERNS.numero_articolo.test(articolo)) return { ok: false, reason: `Numero di articolo non valido (${shown(articolo)})` };
  const entry: NormEntry = { tipo_atto: tipo, numero_articolo: articolo };

  const reale = textOf(r.tipo_atto_reale)?.split(/\s+/).join(' ') ?? null;
  if (reale) {
    if (reale.length > 200 || !KNOWN_TYPES.has(key(reale))) return { ok: false, reason: `Tipo di atto non riconosciuto (${shown(reale)})` };
    entry.tipo_atto_reale = reale;
  }
  for (const field of ['numero_atto', 'data', 'allegato'] as const) {
    const value = textOf(r[field]);
    if (!value) continue;
    if (!PATTERNS[field].test(value)) return { ok: false, reason: `${FIELD_REASONS[field]} (${shown(value)})` };
    entry[field] = value;
  }
  const versione = textOf(r.versione)?.toLowerCase();
  if (versione) {
    if (versione !== 'vigente' && versione !== 'originale') return { ok: false, reason: `Versione non valida (${shown(versione)})` };
    entry.versione = versione;
  }
  const dataVersione = textOf(r.data_versione);
  if (dataVersione) {
    if (!ISO_DAY.test(dataVersione)) return { ok: false, reason: `Data della versione non valida (${shown(dataVersione)})` };
    entry.data_versione = dataVersione;
  }
  // The addresses never reach a citation: kept when they are the sources', else left out.
  const url = sourceUrl(r.url);
  if (url) entry.url = url;
  const urn = textOf(r.urn);
  if (urn && URN.test(urn)) entry.urn = urn;
  else if (sourceUrl(urn)) entry.urn = sourceUrl(urn)!;
  return { ok: true, entry };
}
