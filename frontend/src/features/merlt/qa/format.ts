/** Shared non-component helpers for the Q&A feature (react-refresh boundary). */

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
