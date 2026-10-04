import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }) }));
vi.mock('../../../services/trashService', () => ({ trashService: { list: vi.fn(async () => []), restore: vi.fn(), purge: vi.fn() } }));

import { appStore } from '../../../store/useAppStore';
import { DossierPage } from './DossierPage';

describe('DossierPage', () => {
  it('opens the trash on ?trash=1', async () => {
    appStore.setState({ dossiers: [] });
    render(<MemoryRouter initialEntries={['/dossier?trash=1']}><DossierPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Cestino' })).toBeInTheDocument();
    expect(await screen.findByText('Il cestino è vuoto')).toBeInTheDocument();
  });
});
