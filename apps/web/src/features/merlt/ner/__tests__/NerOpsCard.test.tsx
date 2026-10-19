import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchNerStats = vi.fn();
const startNerTraining = vi.fn();
const fetchNerTrainingStatus = vi.fn();

vi.mock('../nerOpsApi', async () => {
  const actual = await vi.importActual<typeof import('../nerOpsApi')>('../nerOpsApi');
  return {
    ...actual,
    fetchNerStats: () => fetchNerStats(),
    startNerTraining: () => startNerTraining(),
    fetchNerTrainingStatus: (id: string) => fetchNerTrainingStatus(id),
  };
});

import { NerOpsCard } from '../NerOpsCard';

beforeEach(() => {
  fetchNerStats.mockReset().mockResolvedValue({
    total: 5,
    untrained: 2,
    by_type: { confirmation: 5 },
    by_surface: { article_xref: 5 },
  });
  startNerTraining.mockReset();
  fetchNerTrainingStatus.mockReset();
});

describe('NerOpsCard', () => {
  it('loads and renders ner_feedback stats', async () => {
    render(<NerOpsCard />);
    await waitFor(() => expect(screen.getByText('Totale riscontri')).toBeInTheDocument());
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    expect(screen.getByText('article_xref')).toBeInTheDocument();
  });

  it('starts training, polls to completion and shows the A/B report', async () => {
    startNerTraining.mockResolvedValue({ task_id: 't1', status: 'queued' });
    fetchNerTrainingStatus.mockResolvedValue({
      task_id: 't1',
      status: 'finished',
      result: {
        trained: true,
        examples: 10,
        ab_report: {
          test_examples: 2,
          baseline: { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 2 },
          learned: { precision: 0.9, recall: 0.8, f1: 0.85, tp: 2, fp: 0, fn: 0 },
        },
      },
    });

    render(<NerOpsCard />);
    await waitFor(() => expect(screen.getByText('Totale riscontri')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /avvia training ner/i }));

    await waitFor(() => expect(screen.getByText(/training completato/i)).toBeInTheDocument());
    expect(screen.getByText(/appreso/i)).toBeInTheDocument();
    expect(startNerTraining).toHaveBeenCalledTimes(1);
  });
});
