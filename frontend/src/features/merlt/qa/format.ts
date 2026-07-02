/** Shared non-component helpers for the Q&A feature (react-refresh boundary). */

import type { QaRetrievedSource } from './types';

export const CANON_LABEL: Record<string, string> = {
  literal: 'Letterale',
  systemic: 'Sistematico',
  principles: 'Principî',
  precedent: 'Precedente',
  combined: 'Combinato',
};

/** Best-effort readable label for a graph URN / node id. */
export function formatRetrievedUrn(urn: string): string {
  if (urn.startsWith('live:')) return 'Fonte provvisoria';
  const massima = urn.match(/massima_cassazione_([a-z]+)_(\d+)_(\d{4})/i);
  if (massima) return `Cass. ${massima[1].slice(0, 3)}. ${massima[2]}/${massima[3]}`;
  const art = urn.match(/~art([0-9a-z-]+)/i);
  if (art) return `art. ${art[1].replace(/-/g, ' ')}`;
  return urn.length > 60 ? `${urn.slice(0, 57)}…` : urn;
}

/**
 * Human-readable entity name for a consulted source, for the "ricorda nel grafo"
 * (confirm-source) teaching channel. Mirrors {@link QaSourceChip}'s displayed
 * label: for provisional (`live:`) nodes the URN is an opaque hash, so we prefer
 * the underlying Normattiva URL (which yields a readable "art. N") before falling
 * back. NEVER returns the raw `live:` node id — the BFF rejects a name that starts
 * with the provisional id, since a raw id must not become an entity name.
 */
export function confirmSourceEntityText(source: QaRetrievedSource): string {
  const readableUrn = source.urn.startsWith('live:') && source.source_url ? source.source_url : source.urn;
  return formatRetrievedUrn(readableUrn);
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
