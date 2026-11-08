import { act, fireEvent, render, screen } from '@testing-library/react';
import { lazy, type ReactElement } from 'react';
import { Link, MemoryRouter, Outlet, Route, Routes, useSearchParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutePage } from '../RouteBoundary';

// A page whose code arrives when the test says, and one whose code cannot be had.
const arrival = vi.hoisted(() => ({ open: () => {}, openNext: () => {} }));
const Waiting = lazy(() => new Promise<{ default: () => ReactElement }>((resolve) => {
  arrival.open = () => resolve({ default: () => <h1>La pagina</h1> });
}));
const Next = lazy(() => new Promise<{ default: () => ReactElement }>((resolve) => {
  arrival.openNext = () => resolve({ default: () => <h1>La pagina seguente</h1> });
}));
const Missing = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
/** A page that fails on one query («Dossier» with a dossier that breaks it), and draws on the bare address. */
function Fragile() {
  const [params] = useSearchParams();
  if (params.get('dossier') === 'A') throw new Error('broken');
  return <h1>Elenco dei dossier</h1>;
}

/** The layout's frame as `Layout` draws it: the page inside `RoutePage`. */
function Frame() {
  return (
    <div data-testid="layout">
      <nav><Link to="/altra">Altra</Link><Link to="/seguente">Seguente</Link><Link to="/fragile">Dossier</Link></nav>
      <main data-testid="page-place"><RoutePage><Outlet /></RoutePage></main>
    </div>
  );
}

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<Frame />}>
        <Route path="attesa" element={<Waiting />} />
        <Route path="mancante" element={<Missing />} />
        <Route path="altra" element={<h1>Un’altra pagina</h1>} />
        <Route path="seguente" element={<Next />} />
        <Route path="fragile" element={<Fragile />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoutePage — a page loaded with its route', () => {
  it('waits with nothing in its place, the layout drawn, then shows the page', async () => {
    at('/attesa');
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(screen.getByTestId('page-place')).toBeEmptyDOMElement();
    await act(async () => { arrival.open(); });
    expect(await screen.findByRole('heading', { name: 'La pagina' })).toBeInTheDocument();
  });

  it('is reached from another page without a gap: the page left stays until the new one is there', async () => {
    at('/altra');
    fireEvent.click(screen.getByRole('link', { name: 'Seguente' }));
    // The router renders a navigation in a transition: no empty place while the code travels.
    expect(screen.getByRole('heading', { name: 'Un’altra pagina' })).toBeInTheDocument();
    await act(async () => { arrival.openNext(); });
    expect(await screen.findByRole('heading', { name: 'La pagina seguente' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Un’altra pagina' })).toBeNull();
  });

  it('whose code cannot be had keeps the layout and says so with words the app has, and «Riprova» reloads', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
    at('/mancante');
    expect(await screen.findByText('Si è verificato un errore.')).toBeInTheDocument();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(reload).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('the page could not be shown', expect.anything());
  });

  it('draws the page again for the same address with another query, as its entry chosen again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    at('/fragile?dossier=A');
    expect(await screen.findByText('Si è verificato un errore.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Dossier' }));
    expect(await screen.findByRole('heading', { name: 'Elenco dei dossier' })).toBeInTheDocument();
    expect(screen.queryByText('Si è verificato un errore.')).toBeNull();
  });

  it('lets another address draw its page after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    at('/mancante');
    await screen.findByText('Si è verificato un errore.');
    fireEvent.click(screen.getByRole('link', { name: 'Altra' }));
    expect(await screen.findByRole('heading', { name: 'Un’altra pagina' })).toBeInTheDocument();
    expect(screen.queryByText('Si è verificato un errore.')).toBeNull();
  });
});
