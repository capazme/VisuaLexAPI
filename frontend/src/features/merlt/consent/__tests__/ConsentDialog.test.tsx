import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const useConsentMock = vi.fn();
vi.mock('../useConsent', () => ({ useConsent: () => useConsentMock() }));

import { ConsentDialog } from '../ConsentDialog';

const setConsent = vi.fn();

beforeEach(() => {
  setConsent.mockReset().mockResolvedValue(undefined);
  useConsentMock.mockReturnValue({ level: 'none', status: 'ready', setConsent });
});

describe('ConsentDialog', () => {
  it('renders the three consent levels', () => {
    render(<ConsentDialog open onClose={() => {}} />);
    expect(screen.getByTestId('consent-option-none')).toBeInTheDocument();
    expect(screen.getByTestId('consent-option-basic')).toBeInTheDocument();
    expect(screen.getByTestId('consent-option-full')).toBeInTheDocument();
  });

  it('pre-selects the current consent level', () => {
    useConsentMock.mockReturnValue({ level: 'basic', status: 'ready', setConsent });
    render(<ConsentDialog open onClose={() => {}} />);
    expect(screen.getByTestId('consent-option-basic')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('consent-option-full')).toHaveAttribute('aria-checked', 'false');
  });

  it('saving the selected level calls setConsent then onClose', async () => {
    const onClose = vi.fn();
    render(<ConsentDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId('consent-option-full'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /salva/i }));
    });
    expect(setConsent).toHaveBeenCalledWith('full', expect.any(String));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows the granular capabilities for the selected level (full)', () => {
    render(<ConsentDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('consent-option-full'));
    const caps = screen.getByTestId('consent-capabilities');
    expect(caps).toHaveTextContent(/contribuzione/i);
    expect(caps).toHaveTextContent(/validazione/i);
    expect(caps).toHaveTextContent(/grafo/i);
  });

  it('keeps the dialog open and shows an error when setConsent fails', async () => {
    setConsent.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<ConsentDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId('consent-option-basic'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /salva/i }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
