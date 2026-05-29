import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const startTraining = vi.fn();
vi.mock('../../../../services/merltService', () => ({
  startMerltTraining: (...a: unknown[]) => startTraining(...a),
}));

import { OpsTrainingButton } from '../OpsTrainingButton';

beforeEach(() => {
  startTraining.mockReset();
});

describe('OpsTrainingButton (loop-closure A5)', () => {
  it('starts training and shows the ack message', async () => {
    startTraining.mockResolvedValue({
      success: true,
      training_id: 't1',
      message: 'Training avviato con 50 epoch',
    });

    render(<OpsTrainingButton />);
    fireEvent.click(screen.getByRole('button', { name: /Avvia training RLCF/i }));

    await waitFor(() =>
      expect(screen.getByText(/Training avviato con 50 epoch/i)).toBeInTheDocument(),
    );
    expect(startTraining).toHaveBeenCalledOnce();
  });

  it('shows an error message when the service throws', async () => {
    startTraining.mockRejectedValue(new Error('down'));

    render(<OpsTrainingButton />);
    fireEvent.click(screen.getByRole('button', { name: /Avvia training RLCF/i }));

    await waitFor(() =>
      expect(screen.getByText(/non raggiungibile/i)).toBeInTheDocument(),
    );
  });
});
