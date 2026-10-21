import { useEffect, useState } from 'react';
import type { XpEsito } from '../../../../types/studia';

/** «+20 XP» (G1c): what an event earned, as a gain to show, and its words. The chip is `XpGain.tsx` (a file of its own: Fast Refresh wants components alone). */

/** How long «+20 XP» stays: about as long as the session's notice (progress spec decision 6). */
export const XP_GAIN_MS = 1800;

/**
 * True from the frame after the first render: a live region filled in the same render that draws it is not heard,
 * so its words wait for this.
 */
export function useMountedFrame(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return mounted;
}

/** A gain to show: a new `id` shows it again, even for the same points. */
export interface XpGainValue {
  id: number | string;
  punti: number;
  /** The level just reached, when the gain crossed one. */
  livello?: number;
}

/** What an event earned, as a gain to show; null when it earned nothing. */
export function gainOf(id: number | string, xp: XpEsito | undefined): XpGainValue | null {
  const punti = xp?.crediti.reduce((sum, credit) => sum + credit.punti, 0) ?? 0;
  if (!xp || punti <= 0) return null;
  return { id, punti, ...(xp.nuovoLivello ? { livello: xp.livello.livello } : {}) };
}

/** The gain in words, for a screen reader: «XP» would be spelt out letter by letter. */
export function gainSentence(gain: XpGainValue): string {
  return `Hai guadagnato ${gain.punti} ${gain.punti === 1 ? 'punto' : 'punti'}.${gain.livello ? ` Sei al livello ${gain.livello}.` : ''}`;
}

/** «+20 punti» (and «livello 5»): a message's words, which a screen reader reads as they are (the toast). */
export function gainWords(gain: XpGainValue): string {
  return `+${gain.punti} ${gain.punti === 1 ? 'punto' : 'punti'}${gain.livello ? ` · livello ${gain.livello}` : ''}`;
}

/** «+20 XP» (and «Livello 5»), the words of the chip. */
export function gainLabel(gain: XpGainValue): string {
  return `+${gain.punti} XP${gain.livello ? ` · Livello ${gain.livello}` : ''}`;
}
