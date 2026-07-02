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
