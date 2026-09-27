/**
 * Relation endpoints for note-derived relations (B1).
 *
 * The extractor names the two ends of a relation the way the notes do
 * ("risoluzione del contratto"). Promotion must send identifiers the graph
 * writer can MATCH instead, one of:
 *  - a norm: a URN ("urn:nir:...") or a Normattiva URL wrapping one;
 *  - a graph node id or a pending entity id: `<tipo>:<slug>`
 *    ("concetto:risoluzione_del_contratto", "concetto:1a2b3c4d").
 * Same rule as the BFF schema (backend/src/schemas/merlt/contrib.ts) and
 * MERL-T's relation_endpoints.py: a value this rejects would be refused with
 * 400 unresolved_endpoint, so the picker never offers it.
 */

export type RelationEndpointKind = 'norma' | 'entity' | 'pending';

export interface RelationEndpoint {
  /** The identifier sent as sourceUrn / targetEntityId. */
  id: string;
  /** What the user reads (the node name, the norm, the promoted entity). */
  label: string;
  kind: RelationEndpointKind;
}

/** An entity candidate of the same document promoted in this session. */
export interface PromotedEntity {
  candidateId: number;
  /** MERL-T pending entity id (`tipo:<8 hex>`), a valid relation endpoint. */
  pendingId: string;
  label: string;
  tipo?: string;
}

const NORM_URN_RE = /^urn:\S+$/i;
const NORM_URL_RE = /^https?:\/\/\S+$/i;
const ENTITY_ID_RE = /^[a-z][a-z0-9_]*:\S+$/;

export function isNormReference(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (NORM_URN_RE.test(v)) return true;
  return NORM_URL_RE.test(v) && v.toLowerCase().includes('urn:nir:');
}

export function isResolvedRelationEndpoint(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  if (isNormReference(v)) return true;
  if (NORM_URL_RE.test(v)) return false;
  return ENTITY_ID_RE.test(v);
}

/**
 * The endpoint a staged candidate already carries, when the staging parser
 * resolved it (`*_resolved` true and an identifier-shaped value). Anything
 * else, including a missing flag, starts unresolved and asks the user.
 */
export function stagedEndpoint(
  value: string | null | undefined,
  text: string | null | undefined,
  resolved: boolean | null | undefined,
): RelationEndpoint | null {
  const id = (value ?? '').trim();
  if (resolved !== true || !isResolvedRelationEndpoint(id)) return null;
  return {
    id,
    label: (text ?? '').trim() || id,
    kind: isNormReference(id) ? 'norma' : 'entity',
  };
}
