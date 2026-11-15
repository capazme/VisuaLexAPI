import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../consent/useConsent', () => ({ useConsent: () => ({ level: 'none', canTrack: false, status: 'ready', notice: null, refresh: vi.fn() }) }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false }) }));

import { MerltHubPage } from '../../../pages/MerltHubPage';
import { ContribPage } from '../contrib/ContribPage';
import { ValidationPage } from '../validate/ValidationPage';
import { GraphExplorerPage } from '../graph/page/GraphExplorerPage';

const OFF = 'Gli strumenti di Labs non sono accesi su questo server. Ricerca, Work, Learn e Forum funzionano come sempre.';

afterEach(() => vi.unstubAllEnvs());

// Papiniano's pass on #462: with MERL-T off the hub said it plainly, its pages «MERL-T non è disponibile.» and «Grafo
// non disponibile.». Every Labs address says the hub's words, on the same page.
describe('Labs off: one page at every address', () => {
  it.each([
    ['/labs', MerltHubPage],
    ['/labs/contribuisci', ContribPage],
    ['/labs/valida', ValidationPage],
    ['/labs/grafo', GraphExplorerPage],
  ])('%s', (path, Page) => {
    vi.stubEnv('VITE_FEATURE_MERLT', 'false');
    render(<MemoryRouter initialEntries={[path]}><Page /></MemoryRouter>);
    expect(screen.getByText(OFF)).toBeInTheDocument();
    expect(screen.queryByText(/non è disponibile|non disponibile/)).toBeNull();
  });
});
