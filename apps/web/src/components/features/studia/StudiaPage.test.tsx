import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isValidator: false }) }));

import { StudiaPage } from './StudiaPage';

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
});
