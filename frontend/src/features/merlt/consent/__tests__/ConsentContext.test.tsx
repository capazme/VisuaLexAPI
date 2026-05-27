import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { MerltConsentResponse } from '../../../../services/merltService';

// ---- service mock (hoisted) ----
const fetchConsent = vi.fn();
const setConsentApi = vi.fn();
const revokeConsentApi = vi.fn();
vi.mock('../../../../services/merltService', () => ({
  fetchMerltConsent: (...a: unknown[]) => fetchConsent(...a),
  setMerltConsent: (...a: unknown[]) => setConsentApi(...a),
  revokeMerltConsent: (...a: unknown[]) => revokeConsentApi(...a),
}));

import { ConsentProvider } from '../ConsentContext';
import { useConsent } from '../useConsent';
import { getMerltConsentLevel } from '../../merltConsent';

const full: MerltConsentResponse = {
  level: 'full',
  contributionEnabled: true,
  validationEnabled: true,
  graphEnabled: true,
  updatedAt: '2026-05-26T00:00:00.000Z',
  lastAuditAt: '2026-05-26T00:00:00.000Z',
};
const none: MerltConsentResponse = {
  level: 'none',
  contributionEnabled: false,
  validationEnabled: false,
  graphEnabled: false,
  updatedAt: null,
  lastAuditAt: null,
};

function Probe() {
  const { status, level, canTrack, setConsent, revokeConsent } = useConsent();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="level">{level}</span>
      <span data-testid="canTrack">{String(canTrack)}</span>
      <button onClick={() => void setConsent('full', 'ok')}>set-full</button>
      <button onClick={() => void revokeConsent('bye')}>revoke</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ConsentProvider>
      <Probe />
    </ConsentProvider>,
  );
}

beforeEach(() => {
  fetchConsent.mockReset();
  setConsentApi.mockReset();
  revokeConsentApi.mockReset();
  localStorage.removeItem('visualex.merlt.consent');
});

describe('ConsentContext', () => {
  it('hydrates from the server on mount and exposes the server level', async () => {
    fetchConsent.mockResolvedValue(full);
    renderWithProvider();
    expect(screen.getByTestId('status').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('level').textContent).toBe('full');
    expect(screen.getByTestId('canTrack').textContent).toBe('true');
    expect(fetchConsent).toHaveBeenCalledOnce();
  });

  it('uses the localStorage boot cache for the level while loading', async () => {
    localStorage.setItem('visualex.merlt.consent', 'basic');
    let resolve!: (v: MerltConsentResponse) => void;
    fetchConsent.mockReturnValue(new Promise<MerltConsentResponse>((r) => { resolve = r; }));
    renderWithProvider();
    // still loading → effective level comes from the boot cache
    expect(screen.getByTestId('status').textContent).toBe('loading');
    expect(screen.getByTestId('level').textContent).toBe('basic');
    expect(screen.getByTestId('canTrack').textContent).toBe('true');
    await act(async () => { resolve(none); });
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('none'));
  });

  it('server value wins over a stale cache and is written back', async () => {
    localStorage.setItem('visualex.merlt.consent', 'full');
    fetchConsent.mockResolvedValue(none);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('none'));
    expect(getMerltConsentLevel()).toBe('none');
  });

  it('falls back to the cache and reports error when the fetch fails', async () => {
    localStorage.setItem('visualex.merlt.consent', 'full');
    fetchConsent.mockRejectedValue(new Error('network'));
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('level').textContent).toBe('full');
  });

  it('setConsent calls the API, updates state and persists the cache', async () => {
    fetchConsent.mockResolvedValue(none);
    setConsentApi.mockResolvedValue(full);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { screen.getByText('set-full').click(); });
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('full'));
    expect(setConsentApi).toHaveBeenCalledWith('full', 'ok');
    expect(getMerltConsentLevel()).toBe('full');
  });

  it('revokeConsent resets to none and clears the cache', async () => {
    fetchConsent.mockResolvedValue(full);
    revokeConsentApi.mockResolvedValue(none);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('full'));
    await act(async () => { screen.getByText('revoke').click(); });
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('none'));
    expect(revokeConsentApi).toHaveBeenCalledWith('bye');
    expect(getMerltConsentLevel()).toBe('none');
  });

  it('useConsent throws outside of a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow();
    spy.mockRestore();
  });
});
