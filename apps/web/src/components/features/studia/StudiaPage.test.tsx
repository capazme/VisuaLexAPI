import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isValidator: false }) }));
vi.mock('../../../services/studiaService', () => ({
  studiaService: { progress: vi.fn(() => new Promise(() => {})), preferences: vi.fn(() => new Promise(() => {})) },
}));

import { StudiaPage } from './StudiaPage';

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studia" element={<StudiaPage />}>
          <Route path="ripasso" element={<p>oggi</p>} />
          <Route path="ripasso/sessione" element={<p>sessione</p>} />
          <Route path="schede" element={<p>vista</p>} />
          <Route path="schede/:id" element={<p>scheda</p>} />
          <Route path="valida" element={<p>coda</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudiaPage', () => {
  it('heads the view with the section name, leaving its links to the sidebar and the menu button to the layout', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/studia/schede']}>
        <Routes>
          <Route path="/studia" element={<StudiaPage />}>
            <Route path="schede" element={<p>vista</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // The layout starts the page under its menu button: the heading needs no step aside.
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex Gymnasium' }).className).not.toMatch(/\bpl-/);
    expect(container.firstElementChild?.className).not.toMatch(/\bp[xy]?-\d|md:p-\d/);
    // Ripasso, Le mie schede and Da validare are the sidebar's entries now (sections spec S6).
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('vista')).toBeInTheDocument();
  });

  it.each(['/studia/schede', '/studia/schede/k1', '/studia/valida'])('shows the strip, with its gear, over %s (Gymnasium spec §5.1)', (path) => {
    at(path);
    expect(screen.getByRole('button', { name: 'Impostazioni dello studio' })).toBeInTheDocument();
  });

  it.each(['/studia/ripasso', '/studia/ripasso/sessione'])('leaves %s alone: «Oggi» draws its own strip, the session is a lesson', (path) => {
    at(path);
    expect(screen.queryByRole('button', { name: 'Impostazioni dello studio' })).toBeNull();
  });
});
