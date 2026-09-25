import { describe, it, expect } from 'vitest';
import {
  isResolvedRelationEndpoint,
  promoteRequestSchema,
  RELATION_ENDPOINT_ERROR,
} from '../../../src/schemas/merlt/contrib';

/**
 * B1: relation endpoints must reach MERL-T as identifiers the graph writer can
 * MATCH (norm URN/URL, graph node id, pending entity id), never the concept
 * name the LLM wrote. Mirrors merlt/storage/graph/relation_endpoints.py.
 */
describe('isResolvedRelationEndpoint', () => {
  it.each([
    'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    'urn:nir:stato:regio.decreto:1942-03-16;262~art1453!vig=',
    'URN:NIR:stato:legge:1990-08-07;241~art3',
    'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    'concetto:risoluzione_del_contratto',
    'principio:buona_fede',
    'concetto:1a2b3c4d',
    'norma:9f8e7d',
    '  concetto:risoluzione  ',
  ])('accepts %s', (value) => {
    expect(isResolvedRelationEndpoint(value)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'risoluzione del contratto',
    'inadempimento',
    'Concetto:risoluzione',
    'concetto: risoluzione del contratto',
    ':risoluzione',
    'concetto:',
    'https://example.com/risoluzione',
    'urn:',
  ])('rejects %j', (value) => {
    expect(isResolvedRelationEndpoint(value)).toBe(false);
  });
});

describe('promoteRequestSchema (relation)', () => {
  const base = {
    candidateType: 'relation' as const,
    articleUrn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    sourceUrn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    targetEntityId: 'concetto:risoluzione_del_contratto',
    tipoRelazione: 'DISCIPLINA',
    descrizione: 'Riformulazione.',
    fonte: 'Appunti personali',
    attested: true,
  };

  it('parses resolved endpoints and trims them', () => {
    const parsed = promoteRequestSchema.parse({ ...base, targetEntityId: ' concetto:risoluzione ' });
    expect(parsed.candidateType === 'relation' && parsed.targetEntityId).toBe('concetto:risoluzione');
  });

  it('flags an unresolved endpoint with the unresolved_endpoint message', () => {
    const res = promoteRequestSchema.safeParse({ ...base, sourceUrn: 'risoluzione del contratto' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.map((i) => i.message)).toContain(RELATION_ENDPOINT_ERROR);
      expect(res.error.issues[0].path).toEqual(['sourceUrn']);
    }
  });

  it('caps an endpoint at 300 characters (the MERL-T column width)', () => {
    const res = promoteRequestSchema.safeParse({ ...base, targetEntityId: `concetto:${'x'.repeat(300)}` });
    expect(res.success).toBe(false);
  });

  it('leaves entity promotion untouched', () => {
    const res = promoteRequestSchema.safeParse({
      candidateType: 'entity',
      nome: 'Risoluzione',
      tipo: 'concetto',
      descrizione: 'Riformulazione.',
      fonte: 'Appunti personali',
      attested: true,
    });
    expect(res.success).toBe(true);
  });
});
