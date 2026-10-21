import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LevelBar } from './LevelBar';

const SEEN = 'visualex.studia.visto';
afterEach(() => localStorage.removeItem(SEEN));

describe('the level bar (Gymnasium XP spec §4, G1c)', () => {
  it('says the level, what the next one still asks and today’s points, in words for a screen reader', () => {
    render(<LevelBar livello={{ livello: 4, totale: 412, nelLivello: 37, perIlProssimo: 175, oggi: 45 }} />);
    const bar = screen.getByTestId('level-bar');
    expect(bar).toHaveTextContent('Livello 4');
    expect(bar).toHaveTextContent('Ancora 138 XP per il livello 5');
    expect(bar).toHaveTextContent('oggi +45 XP');
    expect(screen.getByText('Ancora 138 punti per il livello 5. Oggi 45 punti.')).toHaveClass('sr-only');
    // The bar is the text's picture: 37 of 175.
    const fill = bar.querySelector('span[aria-hidden] > span') as HTMLElement;
    expect(fill.style.width).toBe(`${(37 / 175) * 100}%`);
    // Nothing grew on a first visit.
    expect(screen.queryByTestId('xp-gain')).toBeNull();
  });

  it('leaves today’s points out on a day with none', () => {
    render(<LevelBar livello={{ livello: 1, totale: 0, nelLivello: 0, perIlProssimo: 100, oggi: 0 }} />);
    expect(screen.getByTestId('level-bar')).not.toHaveTextContent('oggi');
  });

  it('shows what grew since this browser drew it, and announces a level not yet shown, once', async () => {
    localStorage.setItem(SEEN, JSON.stringify({ xp: 90, livello: 1 }));
    const { unmount } = render(<LevelBar livello={{ livello: 2, totale: 110, nelLivello: 10, perIlProssimo: 125, oggi: 20 }} />);
    expect(screen.getByTestId('xp-gain')).toHaveTextContent('+20 XP');
    await waitFor(() => expect(screen.getByText('Nuovo livello: sei al livello 2.')).toBeInTheDocument());
    unmount();
    render(<LevelBar livello={{ livello: 2, totale: 110, nelLivello: 10, perIlProssimo: 125, oggi: 20 }} />);
    expect(screen.queryByTestId('xp-gain')).toBeNull();
    expect(screen.queryByText(/Nuovo livello/)).toBeNull();
  });
});
