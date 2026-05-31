import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const askQuestion = vi.fn();
const refineQuestion = vi.fn();
const rateAnswer = vi.fn();
const rateSource = vi.fn();
const confirmSource = vi.fn();

vi.mock('../qaApi', () => ({
  askQuestion: (...a: unknown[]) => askQuestion(...a),
  refineQuestion: (...a: unknown[]) => refineQuestion(...a),
  rateAnswer: (...a: unknown[]) => rateAnswer(...a),
  rateSource: (...a: unknown[]) => rateSource(...a),
  preferExpert: vi.fn(),
  rateDetailed: vi.fn(),
  confirmSource: (...a: unknown[]) => confirmSource(...a),
}));

import { useQaThread } from '../useQaThread';

const answer = {
  trace_id: 't1',
  synthesis: 'S',
  mode: 'convergent',
  sources: [],
  retrieved_sources: [{ urn: 'live:abc', provenance: 'live_unconfirmed', trust: 0.6, node_id: 'live:abc' }],
  experts_used: ['literal'],
  confidence: 0.8,
  execution_time_ms: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useQaThread', () => {
  it('ask() appends a turn that resolves to success', async () => {
    askQuestion.mockResolvedValue(answer);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('art 1453?', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
  });

  it('ask() error → error state', async () => {
    askQuestion.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
  });

  it('refine() appends a second turn', async () => {
    askQuestion.mockResolvedValue(answer);
    refineQuestion.mockResolvedValue({ ...answer, trace_id: 't2' });
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await act(async () => {
      await result.current.refine('t1', 'e la diffida?');
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
  });

  it('rate() sets optimistic rating and fires the feedback', async () => {
    askQuestion.mockResolvedValue(answer);
    rateAnswer.mockResolvedValue(undefined);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    act(() => {
      result.current.rate(result.current.turns[0].id, 't1', 5);
    });
    await waitFor(() => expect(result.current.turns[0].rating).toBe(5));
    expect(rateAnswer).toHaveBeenCalledWith('t1', 5);
  });

  it('confirm() marks the source done on success', async () => {
    askQuestion.mockResolvedValue(answer);
    confirmSource.mockResolvedValue(undefined);
    const { result } = renderHook(() => useQaThread());
    await act(async () => {
      await result.current.ask('q', 'convergent');
    });
    await act(async () => {
      await result.current.confirm(result.current.turns[0].id, {
        urn: 'live:abc',
        provenance: 'live_unconfirmed',
        node_id: 'live:abc',
      });
    });
    await waitFor(() => expect(result.current.turns[0].confirmed['live:abc']).toBe('done'));
    expect(confirmSource).toHaveBeenCalledWith('live:abc', 'live:abc');
  });
});
