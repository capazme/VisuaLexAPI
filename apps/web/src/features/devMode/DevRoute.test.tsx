import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth() }));

import { DevRoute } from './DevRoute';

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>Ricerca</p>} />
        <Route path="/labs/grafo" element={<DevRoute><p>Grafo</p></DevRoute>} />
        <Route path="/labs/contribuisci" element={<DevRoute><p>never drawn</p></DevRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DevRoute', () => {
  it('draws the page for an account with the mode on', () => {
    auth.mockReturnValue({ loading: false, devMode: true });
    at('/labs/grafo');
    expect(screen.getByText('Grafo')).toBeInTheDocument();
  });

  it('sends everyone else to the search page', () => {
    auth.mockReturnValue({ loading: false, devMode: false });
    at('/labs/grafo');
    expect(screen.queryByText('Grafo')).toBeNull();
    expect(screen.getByText('Ricerca')).toBeInTheDocument();
  });

  it('draws nothing, and does not redirect, while the account is still being read', () => {
    auth.mockReturnValue({ loading: true, devMode: false });
    const { container } = at('/labs/grafo');
    expect(container).toBeEmptyDOMElement();
  });
});
