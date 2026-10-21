import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LEVEL_ZERO } from '../__fixtures__/xp';
import { XpGain } from './XpGain';
import { XP_GAIN_MS, gainLabel, gainOf, gainSentence } from './xpGains';

afterEach(() => vi.useRealTimers());

describe('«+20 XP» (G1c)', () => {
  it('is what an event earned, nothing when it earned nothing, and names a level crossed', () => {
    expect(gainOf(1, undefined)).toBeNull();
    expect(gainOf(1, { crediti: [], livello: LEVEL_ZERO, nuovoLivello: false })).toBeNull();
    const two = gainOf(2, { crediti: [{ missione: 'dovute', punti: 20 }, { missione: 'obiettivo', punti: 10 }], livello: { ...LEVEL_ZERO, livello: 2 }, nuovoLivello: true });
    expect(two).toEqual({ id: 2, punti: 30, livello: 2 });
    expect(gainLabel(two!)).toBe('+30 XP · Livello 2');
    expect(gainSentence(two!)).toBe('Hai guadagnato 30 punti. Sei al livello 2.');
    expect(gainSentence({ id: 3, punti: 1 })).toBe('Hai guadagnato 1 punto.');
  });

  it('shows the chip, says it politely a frame later, takes no focus, and goes', async () => {
    vi.useFakeTimers();
    render(<XpGain gain={{ id: 1, punti: 20 }} />);
    const chip = screen.getByTestId('xp-gain');
    expect(chip).toHaveTextContent('+20 XP');
    expect(chip).toHaveAttribute('aria-hidden', 'true');
    expect(chip.className).toContain('pointer-events-none');
    expect(document.activeElement).toBe(document.body);
    const region = document.querySelector('[aria-live="polite"]')!;
    expect(region).toHaveTextContent('');
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(region).toHaveTextContent('Hai guadagnato 20 punti.');
    await act(async () => {
      vi.advanceTimersByTime(XP_GAIN_MS + 500);
    });
    expect(region).toHaveTextContent('');
  });

  it('says the same points twice when they are earned twice in a row', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<XpGain gain={{ id: 1, punti: 20 }} />);
    const region = document.querySelector('[aria-live="polite"]')!;
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(region).toHaveTextContent('Hai guadagnato 20 punti.');
    rerender(<XpGain gain={{ id: 2, punti: 20 }} />);
    // Emptied for a frame, then said again.
    expect(region).toHaveTextContent('');
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(region).toHaveTextContent('Hai guadagnato 20 punti.');
  });

  it('draws nothing without a gain', () => {
    render(<XpGain gain={null} />);
    expect(screen.queryByTestId('xp-gain')).toBeNull();
  });
});
