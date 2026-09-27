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
import { ARTICLE_SUFFIX_ALTERNATION } from '../../utils/articleSuffixes';

/** Authority/qualification context attached to every event. */
export interface UserContext {
  userId: string;
  authorityScore?: number;
  baselineQual?: string;
}

const ORDINAL_SPELLING = new RegExp(
  `(\\d+)[\\s_-]?(${ARTICLE_SUFFIX_ALTERNATION})\\b(?:[\\s_-]?(semel)\\b)?`,
  'gi'
);

/**
 * Normalize an URN's article ordinal to the joined form (`~art2bis`,
 * `~art25sexiesdecies`, `~art270bis.1`) whatever the source spelling:
 * `-bis`, ` bis`, `_bis` — after `~art` (Normattiva URN) or `;` (compact URN).
 *
 * The joined form is what the URN generator emits, what the lazy-ingestion
 * job is keyed on and what the MERL-T graph stores (seed `~art30bis`,
 * mechanical ingestion): an event keyed on another spelling never joins its
 * node. The suffixes come from the shared ordinal table, so the numbering past
 * "decies" is read too.
 *
 * Examples:
 *  urn:nir~art1 bis      → urn:nir~art1bis
 *  urn:nir~art1-bis      → urn:nir~art1bis
 *  urn:nir:c.c.:1942;2043 bis → urn:nir:c.c.:1942;2043bis
 *  urn:nir~art1-com2     → unchanged (a comma reference, not an ordinal)
 *  urn:foo:bis~art2      → unchanged (no leading digit)
 */
export function normalizeArticleUrn(urn: string): string {
  return urn.replace(
    ORDINAL_SPELLING,
    (_, head: string, suffix: string, second?: string) =>
      `${head}${suffix.toLowerCase()}${second ? second.toLowerCase() : ''}`
  );
}

/**
 * Build the common header fields. MERL-T's tracking model wraps
 * { type, data, timestamp }; the eventMapper produces a flat object
 * with `type` lifted out, and merltClient.sendEvent() does the wrap.
 */
function baseEvent(type: string, user: UserContext): MerltTrackingEvent {
  const out: MerltTrackingEvent = {
    type,
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
    ...baseEvent('article:viewed', user),
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
    ...baseEvent(payload.kind === 'highlight' ? 'highlight:created' : 'annotation:created', user),
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
    ...baseEvent(payload.kind === 'dossier' ? 'dossier:item_added' : 'bookmark:added', user),
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
    ...baseEvent('citation:clicked', user),
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
    ...baseEvent(`forum:${payload.action}`, user),
    shared_env_id: payload.sharedEnvId,
    // Slice 1 decision (open question §10.3 of design):
    // target_author_id = originalAuthorId from the SharedEnvironment item.
    // Story MERLT-1.10 documents the chosen attribution in
    // docs/merlt-forum-authoring-decision.md and may revisit this.
    target_author_id: payload.originalAuthorId,
  };
}
