import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopBar } from '../TopBar';
import { SECTIONS } from '../../../features/sections/sections';

/** LC130: Learn's planner reads as Work's in the bar's path, «Learn › Lista d'ingresso», its title not a step after it. */
describe('TopBar — the path over the planner', () => {
  it.each([
    [0, '/work/ingresso', ['Work', "Lista d'ingresso"]],
    [1, '/learn/attivita/ingresso', ['Learn', "Lista d'ingresso"]],
    [0, '/work/scadenziario', ['Work', 'Scadenziario']],
    [1, '/learn/attivita/scadenziario', ['Learn', 'Scadenziario']],
    [1, '/learn/attivita/cestino', ['Learn', 'Cestino dei compiti']],
  ] as const)('section %i on %s reads %j', (index, pathname, steps) => {
    // The page's own title, «Attività», as `OpusPage` draws it.
    const scroller = document.createElement('div');
    scroller.innerHTML = '<h1>Attività</h1>';
    document.body.appendChild(scroller);
    try {
      render(
        <MemoryRouter>
          <TopBar section={SECTIONS[index]} pathname={pathname} scroller={scroller} onSearch={vi.fn()} actions={null} />
        </MemoryRouter>,
      );
      const path = screen.getByRole('navigation', { name: 'Percorso' });
      expect(within(path).getAllByRole('listitem').map((li) => li.textContent)).toEqual(steps);
      expect(within(path).getByText(steps[1])).toHaveAttribute('aria-current', 'page');
    } finally {
      scroller.remove();
    }
  });
});
