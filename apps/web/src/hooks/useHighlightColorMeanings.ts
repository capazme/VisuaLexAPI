import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { resolveHighlightMeanings, type HighlightColor } from '../utils/highlightColors';

/**
 * Each colour's meaning for this user: their own where they gave one in Impostazioni, the default
 * (`HIGHLIGHT_COLOR_MEANINGS`) elsewhere. Every place that words a colour's meaning reads it here.
 */
export function useHighlightColorMeanings(): Record<HighlightColor, string> {
  const own = useAppStore((s) => s.settings.highlightColorMeanings);
  return useMemo(() => resolveHighlightMeanings(own), [own]);
}
