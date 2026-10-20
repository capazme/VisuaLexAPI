import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }) }));
vi.mock('../../../services/trashService', () => ({ trashService: { list: vi.fn(async () => []), restore: vi.fn(), purge: vi.fn() } }));
// The detail reads its snapshots on mount: answered here, so no request leaves the test.
vi.mock('../../../services/dossierService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/dossierService')>();
  return { ...actual, dossierService: { ...actual.dossierService, getSnapshots: vi.fn(async () => []) } };
});

import { appStore } from '../../../store/useAppStore';
import { DossierPage } from './DossierPage';
import { sectionStore } from '../../../features/sections/useSection';

describe('DossierPage', () => {
  it('opens the trash on ?trash=1', async () => {
    appStore.setState({ dossiers: [] });
    render(<MemoryRouter initialEntries={['/dossier?trash=1']}><DossierPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Cestino' })).toBeInTheDocument();
    expect(await screen.findByText('Il cestino è vuoto')).toBeInTheDocument();
  });

  it("takes a dossier opened by its address to its kind's section, from any section (sections spec S7)", () => {
    sectionStore.setState({ section: 'forum', dossierKind: 'lavoro' });
    appStore.setState({ dossiers: [{ id: 's', title: 'Diritto penale', kind: 'studio', createdAt: '2026-10-01T00:00:00Z', items: [] }] });
    render(<MemoryRouter initialEntries={['/dossier?dossier=s']}><DossierPage /></MemoryRouter>);
    expect(sectionStore.getState()).toMatchObject({ section: 'gymnasium', dossierKind: 'studio' });
    sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
  });
});
