import { useAppStore } from '../store/useAppStore';
import type { Ink } from '../utils/highlighterRules';

/** The highlighter's ink (A4): the colour saved for new highlights (H1), or «Nessun colore» chosen for the session. */
export function useHighlighterInk(): Ink {
  return useAppStore((s) => (s.highlighterEraser ? 'none' : s.settings.highlightColor));
}
