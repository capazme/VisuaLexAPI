// apps/web/src/utils/decisionLinks.ts
/** False until App.tsx routes /sentenze/:corte/:numero/:anno; the decision-page PR sets it true. */
export const DECISION_PAGE_AVAILABLE = false;

/** A decision as other data names it (graph nodes, imports): loose, possibly incomplete. */
export interface LooseDecisionRef {
  corte: string;
  archivio?: string | null;
  numero: number;
  anno?: number | null;
  sezione?: string | null;
}

const LINKABLE_FIRST_YEAR: Record<string, number> = { cassazione: 1900, corte_costituzionale: 1956 };

/**
 * The page of a decision named by other data, or null when that data cannot make a link (another
 * court, no year, a number out of range). With the archive the path is the identity's and carries
 * no section; without it, the section as written goes along for the page to resolve.
 */
export function linkableDecisionPath(raw: LooseDecisionRef, now: Date = new Date()): string | null {
  const first = LINKABLE_FIRST_YEAR[raw.corte];
  if (first === undefined) return null;
  if (!Number.isInteger(raw.numero) || raw.numero < 1 || raw.numero > 999_999) return null;
  if (raw.anno == null || !Number.isInteger(raw.anno) || raw.anno < first || raw.anno > now.getFullYear()) return null;
  if (raw.corte === 'corte_costituzionale') return `/sentenze/corte-costituzionale/${raw.numero}/${raw.anno}`;
  if (raw.archivio === 'civile' || raw.archivio === 'penale') {
    return `/sentenze/cassazione-${raw.archivio}/${raw.numero}/${raw.anno}`;
  }
  const sezione = raw.sezione?.trim();
  return `/sentenze/cassazione/${raw.numero}/${raw.anno}${sezione ? `?sezione=${encodeURIComponent(sezione)}` : ''}`;
}
