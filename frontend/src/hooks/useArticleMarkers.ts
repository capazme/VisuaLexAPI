import { useEffect, useMemo, useState } from 'react';
import type { Annotation, Highlight } from '../types';
import { HIGHLIGHT_STYLES } from '../utils/highlightColors';
import { getGlobalHighlight, subscribeToHighlight } from './useGlobalSearch';

interface UseArticleMarkersInput {
  rawText: string;
  highlights: Highlight[];
  annotations: Annotation[];
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escapeRegex = (s: string) =>
  s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * Applies highlight <mark> and note-anchor <span> markers to a raw plain
 * text (with \n linebreaks) and returns HTML ready for SafeHTML rendering.
 *
 * All offsets are treated as plain-text offsets (DOM textContent, no \n).
 * Markers are applied right-to-left against the unchanged raw text so
 * offsets stay valid even when multiple spans overlap. Newlines become
 * <br /> at the very end.
 *
 * Does NOT apply dictionary term detection or citation wrapping — those
 * are article-specific and belong in the consumer (ArticleTabContent).
 *
 * Legacy highlights without a valid startOffset fall back to a global
 * regex match (every occurrence), matching the pre-offset behaviour.
 */
export function useArticleMarkers({ rawText, highlights, annotations }: UseArticleMarkersInput): string {
  // Subscribe to the global Cmd+F query so every article body keeps
  // its matches wrapped in a dedicated mark the moment the user types
  // in the search bar, and we can jump to a specific occurrence by
  // ordinal index when they click a result.
  const [searchQuery, setSearchQuery] = useState<string | null>(() => getGlobalHighlight());
  useEffect(() => subscribeToHighlight(setSearchQuery), []);

  return useMemo(() => {
    const raw = rawText || '';

    const plainToRaw = (plainOffset: number) => {
      let rawIdx = 0;
      let plainIdx = 0;
      while (plainIdx < plainOffset && rawIdx < raw.length) {
        if (raw[rawIdx] !== '\n') plainIdx++;
        rawIdx++;
      }
      return rawIdx;
    };

    type Insertion = { pos: number; markup: string; isOpen: boolean; order: number };
    const insertions: Insertion[] = [];
    let order = 0;

    // Highlights with a valid plain-text offset
    highlights.forEach((h) => {
      if (typeof h.startOffset !== 'number' || h.startOffset < 0) return;
      const rawStart = plainToRaw(h.startOffset);
      const rawEnd = plainToRaw(h.startOffset + h.text.length);
      const slice = raw.slice(rawStart, rawEnd).replace(/\n/g, '');
      if (slice.toLowerCase() !== h.text.toLowerCase()) return;
      const hlAuthor = h.originalAuthor?.username
        ?? (h.sourceSuggestionId ? 'utente-rimosso' : null);
      const hlTitle = hlAuthor ? ` title="${escapeAttr(`Evidenziato da @${hlAuthor}`)}"` : '';
      insertions.push({
        pos: rawStart, order: order++, isOpen: true,
        markup: `<mark style="${HIGHLIGHT_STYLES[h.color]}" data-highlight="${h.id}" class="highlight-mark"${hlTitle}>`,
      });
      insertions.push({ pos: rawEnd, order: order++, isOpen: false, markup: '</mark>' });
    });

    // Annotations anchored to a text span
    annotations.forEach((a) => {
      if (typeof a.startOffset !== 'number' || a.startOffset < 0) return;
      if (!a.anchorText) return;
      const rawStart = plainToRaw(a.startOffset);
      const rawEnd = plainToRaw(a.startOffset + a.anchorText.length);
      const slice = raw.slice(rawStart, rawEnd).replace(/\n/g, '');
      if (slice.toLowerCase() !== a.anchorText.toLowerCase()) return;
      insertions.push({
        pos: rawStart, order: order++, isOpen: true,
        markup: `<span class="note-anchor" data-note-id="${a.id}" title="${escapeAttr(a.text)}" style="text-decoration:underline wavy hsl(var(--hl-yellow-fg));text-decoration-thickness:2px;text-underline-offset:3px;cursor:help;">`,
      });
      insertions.push({ pos: rawEnd, order: order++, isOpen: false, markup: '</span>' });
    });

    // Global Cmd+F search query — wrap every occurrence with a dedicated
    // mark carrying a data-search-idx ordinal so the search panel can
    // scroll to and flash a specific hit by index. Operates in plain-text
    // space: indexOf into raw WITHOUT \n so cross-line matches behave
    // like DOM textContent, then plainToRaw translates each hit back.
    if (searchQuery && searchQuery.length >= 2) {
      const plain = raw.replace(/\n/g, '');
      const needle = searchQuery.toLowerCase();
      const hay = plain.toLowerCase();
      let from = 0;
      let searchIdx = 0;
      while (true) {
        const hit = hay.indexOf(needle, from);
        if (hit === -1) break;
        const rawStart = plainToRaw(hit);
        const rawEnd = plainToRaw(hit + searchQuery.length);
        insertions.push({
          pos: rawStart, order: order++, isOpen: true,
          markup: `<mark class="search-match" data-search-idx="${searchIdx}">`,
        });
        insertions.push({ pos: rawEnd, order: order++, isOpen: false, markup: '</mark>' });
        searchIdx++;
        from = hit + 1;
      }
    }

    // Apply latest → earliest. Each insertion at a given position pushes
    // whatever was already there to the right, so the LAST entry inserted
    // at pos P ends up FIRST in the output at pos P. When two highlights
    // share a boundary (close of H1 = open of H2 at the same pos), we
    // want the rendered order to be `</mark><mark …>` — i.e. close first.
    // That means close must be inserted LAST at that position, so it must
    // appear LATER in the sorted array than open. Hence: open before close.
    insertions.sort((x, y) => {
      if (y.pos !== x.pos) return y.pos - x.pos;
      if (x.isOpen !== y.isOpen) return x.isOpen ? -1 : 1;
      return y.order - x.order;
    });

    let html = raw;
    insertions.forEach((ins) => {
      html = html.slice(0, ins.pos) + ins.markup + html.slice(ins.pos);
    });

    // Legacy highlights without offset: global match (every occurrence)
    const legacyHighlights = highlights.filter(
      (h) => typeof h.startOffset !== 'number' || h.startOffset < 0
    );
    const sortedLegacy = [...legacyHighlights].sort((a, b) => b.text.length - a.text.length);
    sortedLegacy.forEach((h) => {
      const escaped = escapeRegex(h.text);
      const regex = new RegExp(`(?<!<mark[^>]*>)${escaped}(?!</mark>)`, 'gi');
      const legacyAuthor = h.originalAuthor?.username
        ?? (h.sourceSuggestionId ? 'utente-rimosso' : null);
      const legacyTitle = legacyAuthor ? ` title="${escapeAttr(`Evidenziato da @${legacyAuthor}`)}"` : '';
      html = html.replace(regex, (match) =>
        `<mark style="${HIGHLIGHT_STYLES[h.color]}" data-highlight="${h.id}" class="highlight-mark"${legacyTitle}>${match}</mark>`);
    });

    // \n → <br /> last, after markers are placed.
    return html.replace(/\n/g, '<br />');
  }, [rawText, highlights, annotations, searchQuery]);
}
