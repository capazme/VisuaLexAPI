/**
 * Mappers between store-side types (types/index.ts) and the Node backend
 * wire protocol (types/api.ts).
 *
 * The store splits highlights/annotations by (normaKey, articleId) for
 * convenience, but the backend schema is keyed only on normaKey. We encode
 * the article identity into normaKey using a stable separator, and recover
 * it on read. That keeps the backend model unchanged while the store API
 * stays ergonomic.
 */

import type { Annotation as StoreAnnotation, Highlight as StoreHighlight } from '../types';
import type {
  AnnotationCreate,
  AnnotationResponse,
  HighlightCreate,
  HighlightResponse,
} from '../types/api';

const ARTICLE_SEPARATOR = '::art::';

export function buildWireNormaKey(itemKey: string, articleId: string): string {
  return `${itemKey}${ARTICLE_SEPARATOR}${articleId}`;
}

/**
 * Prefix under which an article AND all its sub-sections (brocardi/ratio,
 * brocardi/spiegazione, …) live on the wire. The backend normaKeyPrefix
 * startsWith query returns every row whose key begins with this prefix in
 * a single round trip.
 *
 * articleId is normalised to its "root" — anything past the first `/` is
 * treated as a sub-section, so `2043/brocardi/ratio` maps to the same
 * prefix as `2043`.
 */
export function buildWireNormaKeyPrefix(itemKey: string, articleId: string): string {
  const rootArticleId = articleRootOf(articleId);
  return `${itemKey}${ARTICLE_SEPARATOR}${rootArticleId}`;
}

/**
 * Strip brocardi sub-section suffix (if any) from an articleId. Keeps
 * the article proper as cache key / prefix root.
 */
export function articleRootOf(articleId: string): string {
  const slash = articleId.indexOf('/');
  return slash === -1 ? articleId : articleId.slice(0, slash);
}

export function parseWireNormaKey(wireKey: string): { normaKey: string; articleId: string } {
  const idx = wireKey.indexOf(ARTICLE_SEPARATOR);
  if (idx === -1) {
    // Legacy / malformed — treat the whole thing as normaKey with empty article
    return { normaKey: wireKey, articleId: '' };
  }
  return {
    normaKey: wireKey.slice(0, idx),
    articleId: wireKey.slice(idx + ARTICLE_SEPARATOR.length),
  };
}

// ── Highlight ────────────────────────────────────────────────────────────

export function highlightStoreToCreate(h: StoreHighlight): HighlightCreate | null {
  // Backend requires valid offsets. Highlights saved before startOffset was
  // added cannot be persisted server-side — caller should handle null.
  if (typeof h.startOffset !== 'number' || h.startOffset < 0) return null;
  // Backend palette includes 'purple'; store palette does not yet use it, but
  // the union is a superset so this cast is safe.
  return {
    normaKey: buildWireNormaKey(h.normaKey, h.articleId),
    text: h.text,
    color: h.color,
    startOffset: h.startOffset,
    endOffset: h.startOffset + h.text.length,
  };
}

export function highlightApiToStore(r: HighlightResponse): StoreHighlight {
  const { normaKey, articleId } = parseWireNormaKey(r.normaKey);
  // Store type excludes 'purple' — clamp to 'yellow' defensively if it appears.
  const color: StoreHighlight['color'] =
    r.color === 'purple' ? 'yellow' : r.color;
  return {
    id: r.id,
    normaKey,
    articleId,
    text: r.text,
    color,
    rangeSerialized: '',
    startOffset: r.startOffset,
  };
}

// ── Annotation ───────────────────────────────────────────────────────────

export function annotationStoreToCreate(a: StoreAnnotation): AnnotationCreate {
  return {
    normaKey: buildWireNormaKey(a.normaKey, a.articleId),
    content: a.text,
    annotationType: 'note',
    // Anchor span metadata: backend stores it in textContext + position.
    // Omitted for legacy notes saved without an anchor.
    ...(a.anchorText ? { textContext: a.anchorText } : {}),
    ...(typeof a.startOffset === 'number' && a.startOffset >= 0
      ? { position: a.startOffset }
      : {}),
  };
}

export function annotationApiToStore(r: AnnotationResponse): StoreAnnotation {
  const { normaKey, articleId } = parseWireNormaKey(r.normaKey);
  return {
    id: r.id,
    normaKey,
    articleId,
    text: r.content,
    createdAt: r.createdAt,
    ...(r.textContext ? { anchorText: r.textContext } : {}),
    ...(typeof r.position === 'number' ? { startOffset: r.position } : {}),
  };
}
