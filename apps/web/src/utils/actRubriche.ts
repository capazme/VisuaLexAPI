import type { ActRubricheResponse, RubrichePart } from './actStructureCache';
import { normalizeArticleId } from './treeUtils';

/**
 * Which article titles belong to the articles in view. Every annex has its own
 * article 1 ("Capacità giuridica" in the codice civile, "Indicazione delle fonti"
 * in the preleggi), and the top-level map of an act in parts can be an annex's:
 * measured on d.lgs. 196/2003, whose top-level art. 1 is "Delibera del Garante
 * n. 515…" while its body is the part "Dispositivo". So an act in parts gets the
 * part matched by its article numbers, or nothing — never the top-level map.
 * Matched by ARTICLE NUMBERS rather than by name: the AKN part names ("CODICE
 * CIVILE") and the annex labels are only sometimes the same string, while the
 * article sets always coincide. Used by the index window and the dossier.
 */
export function matchRubrichePart(parts: RubrichePart[], articleNumbers: string[]): RubrichePart | null {
  if (parts.length === 0 || articleNumbers.length === 0) return null;
  const wanted = new Set(articleNumbers.map(normalizeArticleId));
  let best: RubrichePart | null = null;
  let bestScore = 0;
  for (const part of parts) {
    const overlap = part.keys.reduce((n, k) => (wanted.has(normalizeArticleId(k)) ? n + 1 : n), 0);
    if (overlap > bestScore) {
      bestScore = overlap;
      best = part;
    }
  }
  // A real majority: a couple of shared numbers is coincidence (every annex has
  // an article 1), a matching set is identification.
  return bestScore >= Math.max(1, Math.min(wanted.size, best?.keys.length ?? 0) * 0.5) ? best : null;
}

/** The part of an act in view: none for an act with no parts, the matched part (or none) otherwise. */
function partInView(answer: Pick<ActRubricheResponse, 'parts'>, annexArticleNumbers: string[] | null): RubrichePart | null | 'flat' {
  const parts = answer.parts ?? [];
  return parts.length === 0 ? 'flat' : matchRubrichePart(parts, annexArticleNumbers ?? []);
}

/** The titles of the articles in view, keyed the way article numbers are compared (gotcha 9). */
export function rubricheFor(answer: ActRubricheResponse, annexArticleNumbers: string[] | null): Record<string, string> {
  const part = partInView(answer, annexArticleNumbers);
  const source = part === 'flat' ? (answer.rubriche ?? {}) : (part?.rubriche ?? {});
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value) map[normalizeArticleId(key)] = value;
  }
  return map;
}

/** The repealed articles in view, by the same rule. */
export function abrogatiFor(answer: ActRubricheResponse, annexArticleNumbers: string[] | null): Set<string> {
  const part = partInView(answer, annexArticleNumbers);
  const source = part === 'flat' ? (answer.abrogati ?? []) : (part?.abrogati ?? []);
  return new Set(source.map(normalizeArticleId));
}
