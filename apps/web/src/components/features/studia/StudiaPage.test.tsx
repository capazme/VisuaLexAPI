import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isValidator: false }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth }));

import { StudiaPage } from './StudiaPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/studia/schede']}>
      <Routes>
        <Route path="/studia" element={<StudiaPage />}>
          <Route path="schede" element={<p>vista</p>} />
          <Route path="valida" element={<p>coda</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.isValidator = false;
});

describe('StudiaPage', () => {
  it('offers «Da validare» to a validator, and links to the queue', () => {
    auth.isValidator = true;
    renderPage();
    expect(screen.getByRole('link', { name: 'Da validare' })).toHaveAttribute('href', '/studia/valida');
    expect(screen.getByRole('link', { name: 'Le mie schede' })).toBeInTheDocument();
  });

  it('does not offer «Da validare» to anyone else', () => {
    renderPage();
    expect(screen.queryByRole('link', { name: 'Da validare' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Le mie schede' })).toBeInTheDocument();
  });

  it('leaves the menu button to the layout, and adds no padding of its own', () => {
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
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex Studia' }).className).not.toMatch(/\bpl-/);
    expect(container.firstElementChild?.className).not.toMatch(/\bp[xy]?-\d|md:p-\d/);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Ripasso', 'Le mie schede']);
    expect(screen.getByText('vista')).toBeInTheDocument();
  });
});
