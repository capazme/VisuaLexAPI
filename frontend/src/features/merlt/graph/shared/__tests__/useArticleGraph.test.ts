import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useArticleGraph } from '../useArticleGraph';
import type { SubgraphResponse } from '../types';

const fetchArticleGraphMock = vi.fn();
vi.mock('../graphApi', () => ({
  fetchArticleGraph: (...args: unknown[]) => fetchArticleGraphMock(...args),
}));

const SAMPLE: SubgraphResponse = {
  nodes: [
    { id: 'a', urn: 'urn:a', type: 'Norma', label: 'A' },
    { id: 'b', type: 'Principio', label: 'B' },
  ],
  edges: [
    { id: 'e-ok', source: 'a', target: 'b', type: 'ESPRIME_PRINCIPIO' },
    { id: 'e-bad', source: 'a', target: 'ghost', type: 'X' },
  ],
  metadata: { total_nodes: 2 },
};

beforeEach(() => {
  fetchArticleGraphMock.mockReset();
});

describe('useArticleGraph', () => {
  it('stays idle and does not fetch when urn is null', () => {
    const { result } = renderHook(() => useArticleGraph(null));
    expect(result.current.status).toBe('idle');
    expect(fetchArticleGraphMock).not.toHaveBeenCalled();
  });

  it('transitions loading → success and exposes transformed elements + raw data', async () => {
    fetchArticleGraphMock.mockResolvedValue(SAMPLE);

    const { result } = renderHook(() => useArticleGraph('urn:a'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    if (result.current.status !== 'success') throw new Error('expected success');

    expect(result.current.data).toEqual(SAMPLE);
    // Dangling edge dropped by the transform.
    expect(result.current.elements.nodes).toHaveLength(2);
    expect(result.current.elements.edges.map((e) => e.id)).toEqual(['e-ok']);
  });

  it('passes the depth argument through to the API', async () => {
    fetchArticleGraphMock.mockResolvedValue(SAMPLE);
    renderHook(() => useArticleGraph('urn:a', 3, 25));
    await waitFor(() => expect(fetchArticleGraphMock).toHaveBeenCalledWith('urn:a', 3, 25));
  });

  it('transitions loading → error when the fetch rejects', async () => {
    fetchArticleGraphMock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useArticleGraph('urn:a'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('expected error');
    expect(result.current.error.message).toBe('boom');
  });

  it('discards a stale response when the urn changes mid-flight', async () => {
    let resolveA: ((v: SubgraphResponse) => void) | null = null;
    const aPending = new Promise<SubgraphResponse>((r) => {
      resolveA = r;
    });
    const bResponse: SubgraphResponse = {
      nodes: [{ id: 'b1', type: 'Norma', label: 'B1' }],
      edges: [],
    };

    fetchArticleGraphMock
      .mockReturnValueOnce(aPending) // urn:a — never resolves until we say so
      .mockResolvedValueOnce(bResponse); // urn:b

    const { result, rerender } = renderHook(({ urn }) => useArticleGraph(urn), {
      initialProps: { urn: 'urn:a' },
    });

    // Switch to urn:b before urn:a resolves.
    rerender({ urn: 'urn:b' });
    await waitFor(() => expect(result.current.status).toBe('success'));
    if (result.current.status !== 'success') throw new Error('expected success');
    expect(result.current.data).toEqual(bResponse);

    // Late resolution of the stale urn:a request must NOT overwrite urn:b.
    await act(async () => {
      resolveA?.(SAMPLE);
    });
    if (result.current.status !== 'success') throw new Error('expected success');
    expect(result.current.data).toEqual(bResponse);
  });

  it('refetch re-issues the request', async () => {
    fetchArticleGraphMock.mockResolvedValue(SAMPLE);

    const { result } = renderHook(() => useArticleGraph('urn:a'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(fetchArticleGraphMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(fetchArticleGraphMock).toHaveBeenCalledTimes(2));
  });
});
