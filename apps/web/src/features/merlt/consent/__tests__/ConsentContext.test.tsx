import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { MerltConsentResponse, MerltNotice } from '../../../../services/merltService';

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
import { _resetConsentReadForTests, clearConsentRead } from '../consentRead';
import { useConsent } from '../useConsent';
import { NoticeChangedError } from '../context';

const notice: MerltNotice = {
  id: 'notice-1',
  versione: 1,
  titolo: 'MERL-T: i dati della tua attività',
  corpo: 'Primo paragrafo.\n\nSecondo paragrafo.',
  conferma: 'Ho letto l’informativa',
  azione: 'Conferma la scelta',
};

const full: MerltConsentResponse = {
  level: 'full',
  storedLevel: 'full',
  noticeAnswered: true,
  notice,
  contributionEnabled: true,
  validationEnabled: true,
  graphEnabled: true,
  updatedAt: '2026-05-26T00:00:00.000Z',
  lastAuditAt: '2026-05-26T00:00:00.000Z',
};
const fresh: MerltConsentResponse = {
  level: 'none',
  storedLevel: 'none',
  noticeAnswered: false,
  notice,
  contributionEnabled: false,
  validationEnabled: false,
  graphEnabled: false,
  updatedAt: null,
  lastAuditAt: null,
};
const none: MerltConsentResponse = { ...fresh, noticeAnswered: true, updatedAt: '2026-10-13T00:00:00.000Z' };

let lastError: unknown = null;

function Probe() {
  const { status, level, canTrack, needsAnswer, setConsent, revokeConsent } = useConsent();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="level">{level}</span>
      <span data-testid="canTrack">{String(canTrack)}</span>
      <span data-testid="needsAnswer">{String(needsAnswer)}</span>
      <button
        onClick={() =>
          void setConsent('full', 'notice-1', 'ok').catch((err: unknown) => {
            lastError = err;
          })
        }
      >
        set-full
      </button>
      <button onClick={() => void revokeConsent({ reason: 'bye', deleteData: true })}>revoke</button>
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
  lastError = null;
  localStorage.removeItem('visualex.merlt.consent');
  _resetConsentReadForTests();
});

describe('ConsentContext', () => {
  it('hydrates from the server on mount and exposes the server level', async () => {
    fetchConsent.mockResolvedValue(full);
    renderWithProvider();
    expect(screen.getByTestId('status').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('level').textContent).toBe('full');
    expect(screen.getByTestId('canTrack').textContent).toBe('true');
    expect(screen.getByTestId('needsAnswer').textContent).toBe('false');
    expect(fetchConsent).toHaveBeenCalledOnce();
  });

  it('collects nothing while the server has not answered, whatever this browser once kept', async () => {
    localStorage.setItem('visualex.merlt.consent', 'full');
    let resolve!: (v: MerltConsentResponse) => void;
    fetchConsent.mockReturnValue(new Promise<MerltConsentResponse>((r) => { resolve = r; }));
    renderWithProvider();
    expect(screen.getByTestId('status').textContent).toBe('loading');
    expect(screen.getByTestId('canTrack').textContent).toBe('false');
    // The old boot cache and the banner's snooze are removed once.
    expect(localStorage.getItem('visualex.merlt.consent')).toBeNull();
    await act(async () => { resolve(full); });
    await waitFor(() => expect(screen.getByTestId('canTrack').textContent).toBe('true'));
  });

  it('collects nothing when the fetch fails', async () => {
    fetchConsent.mockRejectedValue(new Error('network'));
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('level').textContent).toBe('none');
    expect(screen.getByTestId('canTrack').textContent).toBe('false');
  });

  it('asks for an answer when the current notice was not answered', async () => {
    fetchConsent.mockResolvedValue(fresh);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('needsAnswer').textContent).toBe('true'));
  });

  it('setConsent sends the level with the notice it was chosen under', async () => {
    fetchConsent.mockResolvedValue(fresh);
    setConsentApi.mockResolvedValue(full);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { screen.getByText('set-full').click(); });
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('full'));
    expect(setConsentApi).toHaveBeenCalledWith('full', 'notice-1', 'ok');
    expect(screen.getByTestId('needsAnswer').textContent).toBe('false');
  });

  it('a notice changed meanwhile reads the new one and says so', async () => {
    fetchConsent.mockResolvedValueOnce(fresh).mockResolvedValueOnce({ ...fresh, notice: { ...notice, id: 'notice-2', versione: 2 } });
    // The shape services/api.ts rejects with.
    setConsentApi.mockRejectedValue({ status: 409, message: 'notice_changed', data: { detail: 'notice_changed', notice } });
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { screen.getByText('set-full').click(); });
    await waitFor(() => expect(lastError).toBeInstanceOf(NoticeChangedError));
    expect(fetchConsent).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('level').textContent).toBe('none');
  });

  it('revokeConsent sends the choice to erase and resets to none', async () => {
    fetchConsent.mockResolvedValue(full);
    revokeConsentApi.mockResolvedValue({ ...none, erasure: { requested: true, completed: true } });
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('full'));
    await act(async () => { screen.getByText('revoke').click(); });
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('none'));
    expect(revokeConsentApi).toHaveBeenCalledWith({ reason: 'bye', deleteData: true });
  });

  it('asks the server once when two providers mount together (StrictMode, a remount)', async () => {
    let resolve!: (v: MerltConsentResponse) => void;
    fetchConsent.mockReturnValue(new Promise<MerltConsentResponse>((r) => { resolve = r; }));
    render(
      <StrictMode>
        <ConsentProvider><Probe /></ConsentProvider>
        <ConsentProvider><Probe /></ConsentProvider>
      </StrictMode>,
    );
    await act(async () => { resolve(full); });
    await waitFor(() => expect(screen.getAllByTestId('level').map((e) => e.textContent)).toEqual(['full', 'full']));
    expect(fetchConsent).toHaveBeenCalledOnce();
  });

  it('a server without MERL-T reads as the disabled consent, and is not asked again', async () => {
    // The shape services/api.ts rejects with.
    fetchConsent.mockRejectedValue({ status: 404, message: 'merlt_disabled', data: { detail: 'merlt_disabled' } });
    const first = renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('level').textContent).toBe('none');
    expect(screen.getByTestId('canTrack').textContent).toBe('false');
    expect(screen.getByTestId('needsAnswer').textContent).toBe('false');
    first.unmount();

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(fetchConsent).toHaveBeenCalledOnce();
  });

  it('after a logout, the next account does not join the leaving account\'s read', async () => {
    let resolveFirst!: (v: MerltConsentResponse) => void;
    fetchConsent.mockReturnValueOnce(new Promise<MerltConsentResponse>((r) => { resolveFirst = r; }));
    const first = renderWithProvider();
    first.unmount();
    clearConsentRead();

    fetchConsent.mockResolvedValueOnce(none);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { resolveFirst(full); });
    expect(screen.getByTestId('level').textContent).toBe('none');
    expect(fetchConsent).toHaveBeenCalledTimes(2);
  });

  it('a logout forgets that the server was without MERL-T: the next sign-in asks again', async () => {
    fetchConsent.mockRejectedValueOnce({ status: 404, message: 'merlt_disabled', data: { detail: 'merlt_disabled' } });
    const first = renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    first.unmount();
    clearConsentRead();

    fetchConsent.mockResolvedValueOnce(full);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('full'));
    expect(fetchConsent).toHaveBeenCalledTimes(2);
  });

  it('any other failure stays an error, and the next mount asks again', async () => {
    fetchConsent.mockRejectedValue({ status: 404, message: 'Not Found', data: undefined });
    const first = renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    first.unmount();

    fetchConsent.mockResolvedValue(full);
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('level').textContent).toBe('full'));
    expect(fetchConsent).toHaveBeenCalledTimes(2);
  });

  it('useConsent throws outside of a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow();
    spy.mockRestore();
  });
});
