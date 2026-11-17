import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

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

const original = appStore.getState().fetchUserData;

describe('DossierPage', () => {
  it('opens the trash on ?trash=1', async () => {
    appStore.setState({ dossiers: [] });
    render(<MemoryRouter initialEntries={['/pratiche?trash=1']}><DossierPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Cestino' })).toBeInTheDocument();
    expect(await screen.findByText('Il cestino è vuoto')).toBeInTheDocument();
  });

  it("takes a dossier opened by its address to its kind's section, from any section (sections spec S7)", () => {
    sectionStore.setState({ section: 'forum', dossierKind: 'lavoro' });
    appStore.setState({ dossiers: [{ id: 's', title: 'Diritto penale', kind: 'studio', createdAt: '2026-10-01T00:00:00Z', items: [] }] });
    render(<MemoryRouter initialEntries={['/pratiche?dossier=s']}><DossierPage /></MemoryRouter>);
    expect(sectionStore.getState()).toMatchObject({ section: 'gymnasium', dossierKind: 'studio' });
    sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
  });

  it('LC61: opened by its address from the Forum, with the pratiche read after the first draw, it opens that pratica', () => {
    sectionStore.setState({ section: 'forum', dossierKind: 'studio' });
    appStore.setState({ dossiers: [], dossiersLoaded: false });
    const seen: string[] = [];
    function Probe() { const { search } = useLocation(); seen.push(search); return null; }
    render(<MemoryRouter initialEntries={['/pratiche?dossier=d1']}><DossierPage /><Probe /></MemoryRouter>);
    act(() => {
      appStore.setState({ dossiers: [{ id: 'd1', title: 'Rossi c. Bianchi', kind: 'lavoro', createdAt: '2026-10-01T00:00:00Z', items: [] }], dossiersLoaded: true });
    });
    expect(screen.getByRole('heading', { level: 1, name: /Rossi c\. Bianchi/ })).toBeInTheDocument();
    expect(seen.every((search) => search === '?dossier=d1')).toBe(true);
    sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
  });

  it('LC61: while the pratiche are being read, an address with ?dossier= never draws the list of another kind', () => {
    sectionStore.setState({ section: 'forum', dossierKind: 'studio' });
    appStore.setState({ dossiers: [{ id: 's1', title: 'Diritto penale', kind: 'studio', createdAt: '2026-10-01T00:00:00Z', items: [] }], dossiersLoaded: false, isDataLoaded: false, isLoadingData: true });
    render(<MemoryRouter initialEntries={['/pratiche?dossier=w1']}><DossierPage /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Apro la pratica…');
    expect(screen.queryByText('Diritto penale')).toBeNull();
    act(() => {
      appStore.setState({
        dossiers: [{ id: 'w1', title: 'Condominio', kind: 'lavoro', createdAt: '2026-10-01T00:00:00Z', items: [] }, { id: 's1', title: 'Diritto penale', kind: 'studio', createdAt: '2026-10-01T00:00:00Z', items: [] }],
        dossiersLoaded: true, isDataLoaded: true, isLoadingData: false,
      });
    });
    expect(screen.getByRole('heading', { level: 1, name: /Condominio/ })).toBeInTheDocument();
    expect(sectionStore.getState().section).toBe('opus');
  });

  it('LC61: read, and not among the user\'s pratiche, it says so instead of a list', () => {
    appStore.setState({ dossiers: [], dossiersLoaded: true, isDataLoaded: true, isLoadingData: false });
    render(<MemoryRouter initialEntries={['/pratiche?dossier=zz']}><DossierPage /></MemoryRouter>);
    expect(screen.getByText('Questa pratica non c’è o non è tua.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vai alle pratiche' })).toBeInTheDocument();
  });

  it('LC73: when the pratiche cannot be read, «Riprova» reads them again', () => {
    const fetchUserData = vi.fn(async () => {});
    appStore.setState({ dossiers: [], dossiersLoaded: false, isDataLoaded: false, isLoadingData: false, dataError: 'giù', fetchUserData });
    render(<MemoryRouter initialEntries={['/pratiche?dossier=zz']}><DossierPage /></MemoryRouter>);
    expect(screen.getByText('Non riesco a leggere le pratiche: riprova tra poco.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(fetchUserData).toHaveBeenCalledTimes(1);
    appStore.setState({ dataError: null, fetchUserData: original });
  });
});
