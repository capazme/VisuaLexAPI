import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const runMock = vi.fn();
vi.mock('../opsConfigApi', () => ({ runGraphHygiene: (...a: unknown[]) => runMock(...a) }));

import { OpsHygieneButton } from '../OpsHygieneButton';

beforeEach(() => {
  runMock.mockReset();
});

describe('OpsHygieneButton (co-evolution hygiene on demand)', () => {
  it('runs the sweep and reports the counts', async () => {
    runMock.mockResolvedValue({ success: true, reconciled: 1, decayed: 4, quarantined: 2, pruned: 0 });
    render(<OpsHygieneButton />);
    fireEvent.click(screen.getByRole('button', { name: /pulizia del grafo/i }));
    await waitFor(() =>
      expect(screen.getByText(/1 riconciliati, 4 decaduti, 2 in revisione, 0 rimossi/)).toBeInTheDocument(),
    );
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('names the missing admin key instead of a generic outage', async () => {
    runMock.mockRejectedValue({ response: { data: { detail: 'merlt_auth_misconfigured' } } });
    render(<OpsHygieneButton />);
    fireEvent.click(screen.getByRole('button', { name: /pulizia del grafo/i }));
    await waitFor(() => expect(screen.getByText(/MERLT_API_KEY/)).toBeInTheDocument());
  });

  it('reports an outage on any other failure', async () => {
    runMock.mockRejectedValue(new Error('down'));
    render(<OpsHygieneButton />);
    fireEvent.click(screen.getByRole('button', { name: /pulizia del grafo/i }));
    await waitFor(() => expect(screen.getByText(/non raggiungibile/)).toBeInTheDocument());
  });
});
