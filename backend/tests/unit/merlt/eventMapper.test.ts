import { describe, it, expect } from 'vitest';
import {
  normalizeArticleUrn,
  toMerltArticleViewed,
  toMerltHighlightAnnotation,
  toMerltDossierBookmark,
  toMerltCitationClicked,
  toMerltForumSignal,
} from '../../../src/services/merlt/eventMapper';

const userCtx = {
  userId: 'u-001',
  authorityScore: 0.65,
  baselineQual: 'avvocato',
};

describe('normalizeArticleUrn', () => {
  it('normalizes art with -bis suffix as-is', () => {
    expect(normalizeArticleUrn('urn:nir:stato:codice.civile:1942;1175~art1-bis')).toBe(
      'urn:nir:stato:codice.civile:1942;1175~art1-bis'
    );
  });

  it('normalizes `art1 bis` to `art1-bis`', () => {
    expect(normalizeArticleUrn('urn:nir:stato:codice.civile:1942;1175~art1 bis')).toBe(
      'urn:nir:stato:codice.civile:1942;1175~art1-bis'
    );
  });

  it('normalizes `art1bis` (no separator) to `art1-bis`', () => {
    expect(normalizeArticleUrn('urn:nir:stato:codice.civile:1942;1175~art1bis')).toBe(
      'urn:nir:stato:codice.civile:1942;1175~art1-bis'
    );
  });

  it('handles `art2_ter` (underscore separator)', () => {
    expect(normalizeArticleUrn('urn:nir~art2_ter')).toBe('urn:nir~art2-ter');
  });

  it('handles uppercase suffix (`art1 BIS` → `art1-bis`)', () => {
    expect(normalizeArticleUrn('urn:nir~art1 BIS')).toBe('urn:nir~art1-bis');
  });

  it('handles compact URN form (`;2043 bis` → `;2043-bis`)', () => {
    expect(normalizeArticleUrn('urn:nir:stato:codice.civile:1942;2043 bis')).toBe(
      'urn:nir:stato:codice.civile:1942;2043-bis'
    );
  });

  it('leaves plain URN without suffix untouched', () => {
    expect(normalizeArticleUrn('urn:nir:stato:codice.civile:1942;2043')).toBe(
      'urn:nir:stato:codice.civile:1942;2043'
    );
  });

  it('handles multiple ordinal suffixes in one URN', () => {
    expect(normalizeArticleUrn('urn:a~art1bis|urn:b~art2 ter')).toBe(
      'urn:a~art1-bis|urn:b~art2-ter'
    );
  });

  it('does NOT match `bis` outside a digit context', () => {
    expect(normalizeArticleUrn('urn:foo:bis-without-digit')).toBe('urn:foo:bis-without-digit');
  });
});

describe('toMerltArticleViewed', () => {
  it('maps all fields to snake_case + enriches with user context', () => {
    const out = toMerltArticleViewed(
      {
        articleUrn: 'urn:nir~art2043',
        normaVisitataId: '00000000-0000-0000-0000-000000000001',
        dwellMs: 5000,
        scrollMaxPct: 75,
        sessionId: '00000000-0000-0000-0000-000000000002',
      },
      userCtx
    );

    expect(out).toEqual({
      type: 'article:viewed',
      user_id: 'u-001',
      user_authority: 0.65,
      baseline_qualification: 'avvocato',
      article_urn: 'urn:nir~art2043',
      dwell_ms: 5000,
      scroll_max_pct: 75,
      session_id: '00000000-0000-0000-0000-000000000002',
      norma_visitata_id: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('sends norma_visitata_id=null when missing', () => {
    const out = toMerltArticleViewed(
      {
        articleUrn: 'urn:nir~art1',
        dwellMs: 1000,
        scrollMaxPct: 10,
        sessionId: '00000000-0000-0000-0000-000000000099',
      },
      { userId: 'u-1' }
    );
    expect(out.norma_visitata_id).toBeNull();
    expect(out.user_authority).toBeUndefined();
    expect(out.baseline_qualification).toBeUndefined();
  });

  it('normalizes URN with `-bis` suffix variants', () => {
    const out = toMerltArticleViewed(
      {
        articleUrn: 'urn:nir~art1 bis',
        dwellMs: 1000,
        scrollMaxPct: 30,
        sessionId: '00000000-0000-0000-0000-000000000003',
      },
      userCtx
    );
    expect(out.article_urn).toBe('urn:nir~art1-bis');
  });
});

describe('toMerltHighlightAnnotation', () => {
  it('maps highlight kind to type=highlight:created', () => {
    const out = toMerltHighlightAnnotation(
      {
        kind: 'highlight',
        anchorText: 'la buona fede',
        startOffset: 100,
        articleUrn: 'urn:nir~art1175',
        color: 'yellow',
      },
      userCtx
    );
    expect(out.type).toBe('highlight:created');
    expect(out.entity_text).toBe('la buona fede');
    expect(out.start_offset).toBe(100);
    expect(out.color).toBe('yellow');
    expect(out.note_text).toBeNull();
  });

  it('maps annotation kind to type=annotation:created with noteText', () => {
    const out = toMerltHighlightAnnotation(
      {
        kind: 'annotation',
        anchorText: 'art. 2043',
        startOffset: 0,
        articleUrn: 'urn:nir~art2043',
        noteText: 'Responsabilità extracontrattuale',
      },
      userCtx
    );
    expect(out.type).toBe('annotation:created');
    expect(out.note_text).toBe('Responsabilità extracontrattuale');
    expect(out.color).toBeNull();
  });
});

describe('toMerltDossierBookmark', () => {
  it('maps dossier kind to type=dossier:item_added with dossierId + tags', () => {
    const out = toMerltDossierBookmark(
      {
        kind: 'dossier',
        articleUrn: 'urn:nir~art1218',
        dossierId: '00000000-0000-0000-0000-000000000004',
        tags: ['contratti', 'inadempimento'],
      },
      userCtx
    );
    expect(out.type).toBe('dossier:item_added');
    expect(out.context).toEqual({
      dossier_id: '00000000-0000-0000-0000-000000000004',
      tags: ['contratti', 'inadempimento'],
    });
  });

  it('maps bookmark kind to type=bookmark:added with empty defaults', () => {
    const out = toMerltDossierBookmark(
      {
        kind: 'bookmark',
        articleUrn: 'urn:nir~art1',
      },
      userCtx
    );
    expect(out.type).toBe('bookmark:added');
    expect(out.context).toEqual({ dossier_id: null, tags: [] });
  });
});

describe('toMerltCitationClicked', () => {
  it('maps source + target + text to type=citation:clicked', () => {
    const out = toMerltCitationClicked(
      {
        sourceArticleUrn: 'urn:nir~art1175',
        targetArticleUrn: 'urn:nir~art1218',
        citationText: 'come previsto dall’art. 1218',
      },
      userCtx
    );
    expect(out).toMatchObject({
      type: 'citation:clicked',
      user_id: 'u-001',
      source_urn: 'urn:nir~art1175',
      target_urn: 'urn:nir~art1218',
      citation_text: 'come previsto dall’art. 1218',
    });
  });

  it('preserves null target (unresolved citation)', () => {
    const out = toMerltCitationClicked(
      {
        sourceArticleUrn: 'urn:nir~art1',
        targetArticleUrn: null,
        citationText: 'vedi articolo precedente',
      },
      { userId: 'u-1' }
    );
    expect(out.target_urn).toBeNull();
  });

  it('normalizes URN on both source and target', () => {
    const out = toMerltCitationClicked(
      {
        sourceArticleUrn: 'urn:nir~art1bis',
        targetArticleUrn: 'urn:nir~art2 ter',
        citationText: 'cfr. art. 2-ter',
      },
      { userId: 'u-1' }
    );
    expect(out.source_urn).toBe('urn:nir~art1-bis');
    expect(out.target_urn).toBe('urn:nir~art2-ter');
  });
});

describe('toMerltForumSignal', () => {
  it.each([
    ['like', 'forum:like'],
    ['download', 'forum:download'],
    ['suggestion_accepted', 'forum:suggestion_accepted'],
    ['suggestion_declined', 'forum:suggestion_declined'],
  ] as const)('maps %s action to type=%s', (action, expectedType) => {
    const out = toMerltForumSignal(
      {
        action,
        sharedEnvId: '00000000-0000-0000-0000-000000000005',
        originalAuthorId: '00000000-0000-0000-0000-000000000006',
      },
      userCtx
    );
    expect(out.type).toBe(expectedType);
    expect(out.shared_env_id).toBe('00000000-0000-0000-0000-000000000005');
    expect(out.target_author_id).toBe('00000000-0000-0000-0000-000000000006');
  });

  it('preserves null originalAuthorId (deleted author)', () => {
    const out = toMerltForumSignal(
      {
        action: 'like',
        sharedEnvId: '00000000-0000-0000-0000-000000000005',
        originalAuthorId: null,
      },
      userCtx
    );
    expect(out.target_author_id).toBeNull();
  });
});
