/** Shared non-component helpers for the Q&A feature (react-refresh boundary). */

import type { QaRetrievedSource } from './types';
import { normFromUrn, shortNorm } from '../../../utils/sources';
import { formatDecisionShort } from '../../../utils/decisionLinks';

export const CANON_LABEL: Record<string, string> = {
  literal: 'Letterale',
  systemic: 'Sistematico',
  principles: 'Principî',
  precedent: 'Precedente',
  combined: 'Combinato',
};

/**
 * "Strumenti usati" chips (DeliberationColumn) printed the raw tool name
 * verbatim (`graph_traversal`, `cerca_giurisprudenza`, …) — a human label per
 * known tool, with a de-underscore + capitalize fallback for anything new.
 */
const TOOL_LABEL: Record<string, string> = {
  graph_traversal: 'Traversata sul grafo',
  cerca_giurisprudenza: 'Ricerca giurisprudenza',
  cite_law: 'Testo di legge',
  semantic_search: 'Ricerca semantica',
  graph_search: 'Ricerca sul grafo',
};

/** Human label for a tool name, falling back to underscore→space + capitalized. */
export function toolLabel(toolName: string): string {
  const known = TOOL_LABEL[toolName];
  if (known) return known;
  const spaced = toolName.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function capitalizeFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** `concetto:foo_bar_baz` / `modalita:foo_bar` → "Foo bar baz" (strip prefix, underscores → spaces, capitalize). */
function humanizeConceptId(id: string, prefix: string): string {
  return capitalizeFirst(id.slice(prefix.length).replace(/_/g, ' ').trim());
}

/** Best-effort readable label for a graph URN / node id (no server-resolved title). */
export function formatRetrievedUrn(urn: string): string {
  if (urn.startsWith('live:')) return 'Fonte provvisoria';
  // A decision, by its key or Brocardi's legacy one: the short label (D2) with no section,
  // which the key does not carry. A legacy key with no archive is «Cass.».
  const keyed = urn.match(/^cassazione:(civile|penale):(\d+):(\d{4})$/);
  if (keyed) return formatDecisionShort({ corte: 'cassazione', archivio: keyed[1], numero: Number(keyed[2]), anno: Number(keyed[3]) });
  const court = urn.match(/^corte_costituzionale:(\d+):(\d{4})$/);
  if (court) return formatDecisionShort({ corte: 'corte_costituzionale', numero: Number(court[1]), anno: Number(court[2]) });
  const massima = urn.match(/massima_(?:cassazione_)?(?:(civile|penale)_)?(\d+)_(\d{4})/i);
  if (massima) {
    return formatDecisionShort({ corte: 'cassazione', archivio: massima[1]?.toLowerCase(), numero: Number(massima[2]), anno: Number(massima[3]) });
  }
  // A norm, read from its key (source convention): «art. 2043 c.c.», «art. 12 preleggi».
  const norm = normFromUrn(urn);
  if (norm?.numero_articolo) return shortNorm(norm);
  // An article of an act no table reads: its number alone, never a guessed act.
  const art = urn.match(/~art([0-9a-z-]+)/i);
  if (art) return `art. ${art[1].replace(/-/g, ' ')}`;
  if (urn.startsWith('concetto:')) return humanizeConceptId(urn, 'concetto:');
  if (urn.startsWith('modalita:')) return humanizeConceptId(urn, 'modalita:');
  return urn.length > 60 ? `${urn.slice(0, 57)}…` : urn;
}

/**
 * Human-readable label for a consulted source: server-resolved `title` first
 * (retrieval-time identity, e.g. "Art. 1618. (Inadempimenti dell'affittuario)…"),
 * else the urn/url humanized via {@link formatRetrievedUrn} — for provisional
 * (`live:`) nodes preferring the underlying `source_url` (readable "art. N")
 * before the opaque hash, and "Fonte provvisoria" only as the last resort.
 */
export function sourceLabel(source: QaRetrievedSource): string {
  const title = source.title?.trim();
  if (title) return title;
  const readableUrn = source.urn.startsWith('live:') && source.source_url ? source.source_url : source.urn;
  return formatRetrievedUrn(readableUrn);
}

/**
 * Human-readable entity name for a consulted source, for the "ricorda nel grafo"
 * (confirm-source) teaching channel. Mirrors {@link sourceLabel}: a good server
 * title makes the best entity name; otherwise falls back to urn humanization
 * (for provisional `live:` nodes preferring the underlying Normattiva URL).
 * NEVER returns the raw `live:` node id — the BFF rejects a name that starts
 * with the provisional id, since a raw id must not become an entity name.
 */
export function confirmSourceEntityText(source: QaRetrievedSource): string {
  return sourceLabel(source);
}

/** Visual descriptor for a source's provenance (colored stripe + chip label). */
export interface ProvenanceMeta {
  label: string;
  /** Leading-edge stripe colour class (bg-*). */
  stripe: string;
  /** Chip text colour class. */
  chip: string;
}

const PROVENANCE_META: Record<string, ProvenanceMeta> = {
  seed: { label: 'fondativa', stripe: 'bg-slate-400', chip: 'text-slate-500 dark:text-slate-400' },
  lazy_ingest: { label: 'acquisita', stripe: 'bg-sky-400', chip: 'text-sky-600 dark:text-sky-400' },
  community_validated: { label: 'validata dalla community', stripe: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400' },
  // `confirmed` is the value the promotion engine writes; `live_confirmed` is a legacy alias.
  confirmed: { label: "confermata dall'uso", stripe: 'bg-teal-500', chip: 'text-teal-600 dark:text-teal-400' },
  live_confirmed: { label: 'confermata', stripe: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400' },
  live_unconfirmed: { label: 'provvisoria', stripe: 'bg-amber-400', chip: 'text-amber-600 dark:text-amber-400' },
};

/**
 * Provenance → visual descriptor (single source of truth for QaSourceChip and
 * the Slice 4 deliberation column's source chips). Unknown provenance degrades
 * to a neutral grey stripe with the raw value as the label.
 */
export function provenanceMeta(provenance: string | null | undefined): ProvenanceMeta {
  return (
    (provenance && PROVENANCE_META[provenance]) || {
      label: provenance ?? 'sconosciuta',
      stripe: 'bg-slate-300',
      chip: 'text-slate-400',
    }
  );
}

/**
 * Discriminated classification of a graph urn/node-id for the "Apri" quick-open
 * action on a consulted/cited source (feature 3). `norma` covers Normattiva
 * URLs and `~artN` / `art_*_cc` style urns (opens in the VisuaLex reader via
 * `normRefToSearchParams` + `triggerSearch`); `sentenza` covers case-law node
 * ids (`massima_cassazione_*` / `massima_*`, opened via their `source_url` when
 * known, else a fallback search); everything else is `unknown` (no "Apri").
 */
export type UrnKind =
  | { kind: 'norma' }
  | { kind: 'sentenza' }
  | { kind: 'unknown' };

export function urnKind(urn: string): UrnKind {
  if (!urn) return { kind: 'unknown' };
  if (urn.startsWith('live:')) return { kind: 'unknown' };
  if (/massima_cassazione_|^massima_/i.test(urn)) return { kind: 'sentenza' };
  if (/normattiva\.it/i.test(urn) || urn.startsWith('urn:nir:') || /~art[0-9a-z-]+/i.test(urn) || /art_.*_cc/i.test(urn)) {
    return { kind: 'norma' };
  }
  return { kind: 'unknown' };
}
