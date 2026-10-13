import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { MerltConsentResponse, MerltNotice } from '../../../../services/merltService';

const useConsentIfProvidedMock = vi.fn();
const useConsentMock = vi.fn();
vi.mock('../../consent/useConsent', () => ({
  useConsentIfProvided: () => useConsentIfProvidedMock(),
  useConsent: () => useConsentMock(),
}));
const exportMerltData = vi.fn();
const deleteMerltData = vi.fn();
vi.mock('../../../../services/merltService', () => ({
  exportMerltData: () => exportMerltData(),
  deleteMerltData: () => deleteMerltData(),
}));
const saveBlob = vi.fn();
vi.mock('../../../../utils/saveBlob', () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) }));
let merltOn = true;
vi.mock('../../featureFlag', () => ({ isMerltEnabled: () => merltOn }));

import { MerltDataSection } from '../MerltDataSection';

const notice: MerltNotice = {
  id: 'notice-1',
  versione: 3,
  titolo: 'MERL-T: i dati della tua attività',
  corpo: 'Testo dell’informativa.',
  conferma: 'Ho letto l’informativa',
  azione: 'Conferma la scelta',
};
const basic: MerltConsentResponse = {
  level: 'basic',
  storedLevel: 'basic',
  noticeAnswered: true,
  notice,
  contributionEnabled: false,
  validationEnabled: false,
  graphEnabled: true,
  updatedAt: '2026-10-01T00:00:00.000Z',
  lastAuditAt: null,
};
const revokeConsent = vi.fn();

function contextWith(consent: MerltConsentResponse) {
  return {
    status: 'ready',
    consent,
    level: consent.level,
    canTrack: consent.level !== 'none',
    needsAnswer: !consent.noticeAnswered,
    notice: consent.notice,
    error: null,
    setConsent: vi.fn(),
    revokeConsent,
    refresh: vi.fn(),
  };
}

beforeEach(() => {
  merltOn = true;
  exportMerltData.mockReset();
  deleteMerltData.mockReset();
  saveBlob.mockReset();
  revokeConsent.mockReset();
  useConsentIfProvidedMock.mockReturnValue(contextWith(basic));
  useConsentMock.mockReturnValue(contextWith(basic));
});

describe('Impostazioni › Dati MERL-T', () => {
  it('says what is collected and offers every right', () => {
    render(<MerltDataSection />);
    expect(screen.getByTestId('merlt-consent-status')).toHaveTextContent('Raccolta: Base.');
    for (const name of ['Cambia scelta', 'Leggi l’informativa', 'Scarica i miei dati', 'Elimina i miei dati MERL-T', 'Revoca il consenso']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('says collection is paused while a new notice waits for an answer', () => {
    useConsentIfProvidedMock.mockReturnValue(contextWith({ ...basic, level: 'none', noticeAnswered: false }));
    render(<MerltDataSection />);
    expect(screen.getByTestId('merlt-consent-status')).toHaveTextContent(/In pausa/);
  });

  it('draws nothing where MERL-T is off, or outside the consent provider', () => {
    merltOn = false;
    const { container, rerender } = render(<MerltDataSection />);
    expect(container).toBeEmptyDOMElement();
    merltOn = true;
    useConsentIfProvidedMock.mockReturnValue(null);
    rerender(<MerltDataSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('downloads the copy as a JSON file', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    exportMerltData.mockResolvedValue(blob);
    render(<MerltDataSection />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Scarica i miei dati' })); });
    expect(saveBlob).toHaveBeenCalledWith(blob, expect.stringMatching(/^visualex-dati-merlt-\d{4}-\d{2}-\d{2}\.json$/));
    expect(screen.getByRole('status')).toHaveTextContent('scaricata');
  });

  it('says so when MERL-T cannot give the copy', async () => {
    exportMerltData.mockRejectedValue(new Error('503'));
    render(<MerltDataSection />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Scarica i miei dati' })); });
    expect(screen.getByRole('status')).toHaveTextContent('non è raggiungibile');
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('erases only after a danger confirmation, and says when MERL-T has not confirmed yet', async () => {
    deleteMerltData.mockResolvedValue({ completed: false });
    render(<MerltDataSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina i miei dati MERL-T' }));
    expect(deleteMerltData).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Elimina i dati' })); });
    await waitFor(() => expect(deleteMerltData).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('si completa da sola');
  });

  it('revoking offers to erase what was collected', async () => {
    revokeConsent.mockResolvedValue({ erasureCompleted: true });
    render(<MerltDataSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoca il consenso' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Revoca ed elimina i dati raccolti' }));
    });
    expect(revokeConsent).toHaveBeenCalledWith({ reason: expect.any(String), deleteData: true });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('eliminati'));
  });

  it('reads the notice in full', () => {
    render(<MerltDataSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Leggi l’informativa' }));
    expect(screen.getByText('Versione 3')).toBeInTheDocument();
    expect(screen.getByText('Testo dell’informativa.')).toBeInTheDocument();
  });
});
