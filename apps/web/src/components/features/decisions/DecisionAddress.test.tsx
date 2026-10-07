import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import { DecisionAddress } from './DecisionAddress';

function renderAt(path: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div data-testid="search-page" />} />
          <Route path="/sentenze" element={<DecisionAddress />} />
          <Route path="/sentenze/:corte/:numero/:anno" element={<DecisionAddress />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

beforeEach(() => appStore.setState({ pendingDecision: null, commandPaletteOpen: false, lastSyncError: null }));

describe('DecisionAddress', () => {
  it('queues the decision and lands on the search page, once', async () => {
    renderAt('/sentenze/cassazione-civile/10787/2024');
    await screen.findByTestId('search-page');
    expect(appStore.getState().pendingDecision).toEqual({ corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 });
    expect(appStore.getState().commandPaletteOpen).toBe(false);
  });

  it('keeps the section of a reference without the archive', async () => {
    renderAt('/sentenze/cassazione/10787/2024?sezione=III');
    await screen.findByTestId('search-page');
    expect(appStore.getState().pendingDecision).toMatchObject({ corte: 'cassazione', sezione: 'III' });
  });

  it('reads the Corte costituzionale', async () => {
    renderAt('/sentenze/corte-costituzionale/100/1990');
    await screen.findByTestId('search-page');
    expect(appStore.getState().pendingDecision).toEqual({ corte: 'corte_costituzionale', numero: 100, anno: 1990 });
  });

  it.each([
    ['/sentenze', '/sentenze alone'],
    ['/sentenze/tar-lazio/1/2024', 'an unknown court'],
    ['/sentenze/cassazione-civile/0/2024', 'a number out of range'],
    ['/sentenze/cassazione-civile/10787/1800', 'a year out of range'],
  ])('opens the palette and queues nothing for %s (%s)', async (path) => {
    renderAt(path);
    await screen.findByTestId('search-page');
    expect(appStore.getState().commandPaletteOpen).toBe(true);
    expect(appStore.getState().pendingDecision).toBeNull();
  });

  it('says why an address does not read, in the app\'s error toast', async () => {
    renderAt('/sentenze/tar-lazio/1/2024');
    await screen.findByTestId('search-page');
    expect(appStore.getState().lastSyncError?.message).toBe("L'indirizzo non indica una sentenza leggibile: Organo non riconosciuto.");
  });

  it('says nothing for /sentenze alone or for a good address', async () => {
    const alone = renderAt('/sentenze');
    await screen.findByTestId('search-page');
    expect(appStore.getState().lastSyncError).toBeNull();
    alone.unmount();
    renderAt('/sentenze/cassazione-civile/10787/2024');
    await screen.findByTestId('search-page');
    expect(appStore.getState().lastSyncError).toBeNull();
  });
});
