import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { MerltConsentResponse, MerltNotice } from '../../../../services/merltService';

const useConsentMock = vi.fn();
vi.mock('../useConsent', () => ({ useConsent: () => useConsentMock() }));

import { ConsentScreen } from '../ConsentScreen';
import { ConsentDialog } from '../ConsentDialog';

const notice: MerltNotice = {
  id: 'notice-1',
  versione: 1,
  titolo: 'MERL-T: i dati della tua attività',
  corpo: 'Primo paragrafo dell’informativa.\n\nLe note sul testo: il testo integrale della nota.',
  conferma: 'Ho letto l’informativa',
  azione: 'Conferma la scelta',
};

const neverAsked: MerltConsentResponse = {
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

const setConsent = vi.fn();

function contextWith(consent: MerltConsentResponse) {
  return {
    status: 'ready',
    consent,
    level: consent.level,
    canTrack: consent.level !== 'none',
    needsAnswer: consent.notice !== null && !consent.noticeAnswered,
    notice: consent.notice,
    error: null,
    setConsent,
    revokeConsent: vi.fn(),
    refresh: vi.fn(),
  };
}

beforeEach(() => {
  setConsent.mockReset().mockResolvedValue(undefined);
  useConsentMock.mockReturnValue(contextWith(neverAsked));
});

describe('ConsentScreen — asked once, outside the work', () => {
  it('shows the notice in full and the three levels, none chosen, for someone never asked', () => {
    render(<ConsentScreen />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('MERL-T: i dati della tua attività')).toBeInTheDocument();
    expect(screen.getByTestId('merlt-notice-body')).toHaveTextContent('il testo integrale della nota');
    for (const level of ['none', 'basic', 'full']) {
      expect(screen.getByTestId(`consent-option-${level}`)).toBeInTheDocument();
    }
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Conferma la scelta' })).toBeDisabled();
  });

  it('cannot be dismissed: no close button, Escape does nothing', () => {
    render(<ConsentScreen />);
    expect(screen.queryByRole('button', { name: /chiudi/i })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('«Nessuna raccolta» needs no tick', async () => {
    render(<ConsentScreen />);
    fireEvent.click(screen.getByLabelText(/Nessuna raccolta/));
    const confirm = screen.getByRole('button', { name: 'Conferma la scelta' });
    expect(confirm).toBeEnabled();
    await act(async () => { fireEvent.click(confirm); });
    expect(setConsent).toHaveBeenCalledWith('none', 'notice-1', expect.any(String));
  });

  it('«Base» and «Completo» need the notice ticked', async () => {
    render(<ConsentScreen />);
    fireEvent.click(screen.getByLabelText(/^Base/));
    const confirm = screen.getByRole('button', { name: 'Conferma la scelta' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Ho letto l’informativa/));
    expect(confirm).toBeEnabled();
    await act(async () => { fireEvent.click(confirm); });
    expect(setConsent).toHaveBeenCalledWith('basic', 'notice-1', expect.any(String));
  });

  it('offers the earlier level again when the notice changed, and says why it asks', () => {
    useConsentMock.mockReturnValue(
      contextWith({ ...neverAsked, storedLevel: 'full', updatedAt: '2026-10-01T00:00:00.000Z' }),
    );
    render(<ConsentScreen />);
    expect(screen.getByLabelText(/^Completo/)).toBeChecked();
    expect(screen.getByText(/L’informativa su MERL-T è cambiata/)).toBeInTheDocument();
  });

  it('shows the error and stays open when the choice is not saved', async () => {
    setConsent.mockRejectedValue(new Error('L’informativa è stata aggiornata nel frattempo.'));
    render(<ConsentScreen />);
    fireEvent.click(screen.getByLabelText(/Nessuna raccolta/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Conferma la scelta' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('aggiornata nel frattempo');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('draws nothing once the notice is answered', () => {
    useConsentMock.mockReturnValue(contextWith({ ...neverAsked, noticeAnswered: true }));
    const { container } = render(<ConsentScreen />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ConsentDialog — «Cambia scelta»', () => {
  it('offers the current level, can be cancelled, and closes after saving', async () => {
    useConsentMock.mockReturnValue(
      contextWith({ ...neverAsked, level: 'basic', storedLevel: 'basic', noticeAnswered: true, updatedAt: '2026-10-01T00:00:00.000Z' }),
    );
    const onClose = vi.fn();
    render(<ConsentDialog open onClose={onClose} />);
    expect(screen.getByLabelText(/^Base/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Nessuna raccolta/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Conferma la scelta' })); });
    expect(setConsent).toHaveBeenCalledWith('none', 'notice-1', expect.any(String));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
