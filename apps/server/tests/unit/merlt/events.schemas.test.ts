import { describe, it, expect } from 'vitest';
import {
  articleViewedRequestSchema,
  highlightAnnotationRequestSchema,
  dossierBookmarkRequestSchema,
  citationClickedRequestSchema,
  forumSignalRequestSchema,
  eventRequestSchemas,
} from '../../../src/schemas/merlt/events';

const sampleUuid = '11111111-1111-1111-1111-111111111111';
const otherUuid = '22222222-2222-2222-2222-222222222222';

describe('articleViewedRequestSchema', () => {
  it('accepts a complete valid payload', () => {
    const result = articleViewedRequestSchema.safeParse({
      articleUrn: 'urn:nir:stato:codice.civile:1942-03-16;262~art2043',
      normaVisitataId: sampleUuid,
      dwellMs: 5000,
      scrollMaxPct: 75,
      sessionId: otherUuid,
    });
    expect(result.success).toBe(true);
  });

  it('accepts payload without optional normaVisitataId', () => {
    const result = articleViewedRequestSchema.safeParse({
      articleUrn: 'urn:test',
      dwellMs: 3000,
      scrollMaxPct: 30,
      sessionId: sampleUuid,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty articleUrn', () => {
    const result = articleViewedRequestSchema.safeParse({
      articleUrn: '',
      dwellMs: 1000,
      scrollMaxPct: 50,
      sessionId: sampleUuid,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative dwellMs', () => {
    const result = articleViewedRequestSchema.safeParse({
      articleUrn: 'urn:test',
      dwellMs: -1,
      scrollMaxPct: 50,
      sessionId: sampleUuid,
    });
    expect(result.success).toBe(false);
  });

  it('rejects scrollMaxPct out of [0,100]', () => {
    const r1 = articleViewedRequestSchema.safeParse({
      articleUrn: 'urn:test',
      dwellMs: 1000,
      scrollMaxPct: 150,
      sessionId: sampleUuid,
    });
    expect(r1.success).toBe(false);

    const r2 = articleViewedRequestSchema.safeParse({
      articleUrn: 'urn:test',
      dwellMs: 1000,
      scrollMaxPct: -1,
      sessionId: sampleUuid,
    });
    expect(r2.success).toBe(false);
  });

  it('rejects non-uuid sessionId', () => {
    const result = articleViewedRequestSchema.safeParse({
      articleUrn: 'urn:test',
      dwellMs: 1000,
      scrollMaxPct: 50,
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('highlightAnnotationRequestSchema', () => {
  it('accepts highlight kind', () => {
    const result = highlightAnnotationRequestSchema.safeParse({
      kind: 'highlight',
      anchorText: 'la buona fede contrattuale',
      startOffset: 42,
      articleUrn: 'urn:nir:stato:codice.civile:1942;1175',
      color: 'yellow',
    });
    expect(result.success).toBe(true);
  });

  it('accepts annotation kind with noteText', () => {
    const result = highlightAnnotationRequestSchema.safeParse({
      kind: 'annotation',
      anchorText: 'art. 2043',
      startOffset: 0,
      articleUrn: 'urn:nir:stato:codice.civile:1942;2043',
      noteText: 'Norma cardine della responsabilità extracontrattuale',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid kind', () => {
    const result = highlightAnnotationRequestSchema.safeParse({
      kind: 'comment',
      anchorText: 'x',
      startOffset: 0,
      articleUrn: 'urn:test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects anchorText > 2000 chars', () => {
    const result = highlightAnnotationRequestSchema.safeParse({
      kind: 'highlight',
      anchorText: 'x'.repeat(2001),
      startOffset: 0,
      articleUrn: 'urn:test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative startOffset', () => {
    const result = highlightAnnotationRequestSchema.safeParse({
      kind: 'highlight',
      anchorText: 'x',
      startOffset: -1,
      articleUrn: 'urn:test',
    });
    expect(result.success).toBe(false);
  });
});

describe('dossierBookmarkRequestSchema', () => {
  it('accepts dossier kind with dossierId + tags', () => {
    const result = dossierBookmarkRequestSchema.safeParse({
      kind: 'dossier',
      articleUrn: 'urn:test',
      dossierId: sampleUuid,
      tags: ['contratti', 'responsabilità'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts bookmark kind without dossierId', () => {
    const result = dossierBookmarkRequestSchema.safeParse({
      kind: 'bookmark',
      articleUrn: 'urn:test',
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 20 tags', () => {
    const result = dossierBookmarkRequestSchema.safeParse({
      kind: 'dossier',
      articleUrn: 'urn:test',
      tags: Array(21).fill('x'),
    });
    expect(result.success).toBe(false);
  });
});

describe('citationClickedRequestSchema', () => {
  it('accepts citation with both source and target', () => {
    const result = citationClickedRequestSchema.safeParse({
      sourceArticleUrn: 'urn:nir:stato:codice.civile:1942;1175',
      targetArticleUrn: 'urn:nir:stato:codice.civile:1942;1218',
      citationText: 'come previsto dall’art. 1218',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null target (unresolved citation)', () => {
    const result = citationClickedRequestSchema.safeParse({
      sourceArticleUrn: 'urn:test',
      targetArticleUrn: null,
      citationText: 'vedi precedente articolo',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty citationText', () => {
    const result = citationClickedRequestSchema.safeParse({
      sourceArticleUrn: 'urn:test',
      targetArticleUrn: 'urn:test2',
      citationText: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('forumSignalRequestSchema', () => {
  it('accepts each of the 4 actions', () => {
    const actions = ['like', 'download', 'suggestion_accepted', 'suggestion_declined'] as const;
    for (const action of actions) {
      const result = forumSignalRequestSchema.safeParse({
        action,
        sharedEnvId: sampleUuid,
        originalAuthorId: otherUuid,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts null originalAuthorId (deleted author)', () => {
    const result = forumSignalRequestSchema.safeParse({
      action: 'like',
      sharedEnvId: sampleUuid,
      originalAuthorId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = forumSignalRequestSchema.safeParse({
      action: 'comment',
      sharedEnvId: sampleUuid,
      originalAuthorId: otherUuid,
    });
    expect(result.success).toBe(false);
  });
});

describe('eventRequestSchemas registry', () => {
  it('exposes exactly 5 event keys', () => {
    const keys = Object.keys(eventRequestSchemas).sort();
    expect(keys).toEqual([
      'article-viewed',
      'citation-clicked',
      'dossier-bookmark',
      'forum-signal',
      'highlight-annotation',
    ]);
  });

  it('each entry is a Zod schema (has safeParse)', () => {
    for (const schema of Object.values(eventRequestSchemas)) {
      expect(typeof schema.safeParse).toBe('function');
    }
  });
});
