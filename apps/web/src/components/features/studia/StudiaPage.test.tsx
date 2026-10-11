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

  it('lets the heading start to the right of the layout’s menu button, and adds no padding of its own', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/studia/schede']}>
        <Routes>
          <Route path="/studia" element={<StudiaPage />}>
            <Route path="schede" element={<p>vista</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex Studia' })).toHaveClass('pl-12', 'lg:pl-0');
    expect(container.firstElementChild?.className).not.toMatch(/\bp[xy]?-\d|md:p-\d/);
    expect(screen.getByRole('link', { name: 'Le mie schede' })).toBeInTheDocument();
    expect(screen.getByText('vista')).toBeInTheDocument();
  });
});
