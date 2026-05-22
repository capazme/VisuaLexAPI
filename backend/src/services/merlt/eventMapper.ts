/**
 * Map VisuaLex event payloads → MERL-T tracking events.
 *
 * Single source of truth for the contract translation:
 *  - camelCase → snake_case
 *  - enrich with `user_id` and optional `user_authority` (from cache)
 *  - normalize URN edge cases (e.g. `-bis` vs ` bis` suffix on articleId).
 *    See CLAUDE.md gotcha #9 — the scraper and tree API disagree on this
 *    spelling, so the BFF normalizes to the dash-form before forwarding.
 */

import type {
  ArticleViewedRequest,
  HighlightAnnotationRequest,
  DossierBookmarkRequest,
  CitationClickedRequest,
  ForumSignalRequest,
} from '../../schemas/merlt/events';
import type { MerltTrackingEvent } from './merltClient';

/** Authority/qualification context attached to every event. */
export interface UserContext {
  userId: string;
  authorityScore?: number;
  baselineQual?: string;
}

/**
 * Normalize URN article-id suffix to the dash-form (`art1-bis`) regardless of
 * the source spelling (`art1 bis`, `art1bis`). The MERL-T graph stores URNs in
 * the dash-form (commit 81be277 baseline + Normattiva canonical form), so we
 * unify upstream of the wire.
 */
export function normalizeArticleUrn(urn: string): string {
  // Match `~art<num>(<sep>?)(bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies)`
  return urn.replace(
    /(~art\d+)[\s_]?(bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies)\b/gi,
    (_, head, suffix) => `${head}-${suffix.toLowerCase()}`
  );
}

function baseEvent(eventType: string, user: UserContext): MerltTrackingEvent {
  const out: MerltTrackingEvent = {
    event_type: eventType,
    user_id: user.userId,
  };
  if (user.authorityScore !== undefined) out.user_authority = user.authorityScore;
  if (user.baselineQual) out.baseline_qualification = user.baselineQual;
  return out;
}

// 1. article:viewed
export function toMerltArticleViewed(
  payload: ArticleViewedRequest,
  user: UserContext
): MerltTrackingEvent {
  return {
    ...baseEvent('article_viewed', user),
    article_urn: normalizeArticleUrn(payload.articleUrn),
    dwell_ms: payload.dwellMs,
    scroll_max_pct: payload.scrollMaxPct,
    session_id: payload.sessionId,
    norma_visitata_id: payload.normaVisitataId ?? null,
  };
}

// 2. highlight + annotation
export function toMerltHighlightAnnotation(
  payload: HighlightAnnotationRequest,
  user: UserContext
): MerltTrackingEvent {
  return {
    ...baseEvent(payload.kind === 'highlight' ? 'highlight' : 'annotation', user),
    entity_text: payload.anchorText,
    article_urn: normalizeArticleUrn(payload.articleUrn),
    start_offset: payload.startOffset,
    color: payload.color ?? null,
    note_text: payload.noteText ?? null,
  };
}

// 3. dossier:item:added + bookmark:added
export function toMerltDossierBookmark(
  payload: DossierBookmarkRequest,
  user: UserContext
): MerltTrackingEvent {
  return {
    ...baseEvent('saved_for_use', user),
    save_kind: payload.kind, // discriminate dossier vs bookmark
    article_urn: normalizeArticleUrn(payload.articleUrn),
    context: {
      dossier_id: payload.dossierId ?? null,
      tags: payload.tags ?? [],
    },
  };
}

// 4. citation:clicked
export function toMerltCitationClicked(
  payload: CitationClickedRequest,
  user: UserContext
): MerltTrackingEvent {
  return {
    ...baseEvent('citation_followed', user),
    source_urn: normalizeArticleUrn(payload.sourceArticleUrn),
    target_urn: payload.targetArticleUrn ? normalizeArticleUrn(payload.targetArticleUrn) : null,
    citation_text: payload.citationText,
  };
}

// 5. forum signals
export function toMerltForumSignal(
  payload: ForumSignalRequest,
  user: UserContext
): MerltTrackingEvent {
  return {
    ...baseEvent('community_signal', user),
    action: payload.action,
    shared_env_id: payload.sharedEnvId,
    // Slice 1 decision (open question §10.3 of design):
    // target_author_id = originalAuthorId from the SharedEnvironment item.
    // Story MERLT-1.10 documents the chosen attribution in
    // docs/merlt-forum-authoring-decision.md and may revisit this.
    target_author_id: payload.originalAuthorId,
  };
}
