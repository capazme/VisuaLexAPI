import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useArticleGraph, _clearArticleGraphCache } from '../useArticleGraph';
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
  _clearArticleGraphCache();
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

  describe('F1 — SWR cache + revalidating', () => {
    it('serves a cached key instantly and revalidates in background (update on change)', async () => {
      fetchArticleGraphMock.mockResolvedValue(SAMPLE);
      const first = renderHook(() => useArticleGraph('urn:a'));
      await waitFor(() => expect(first.result.current.status).toBe('success'));
      first.unmount();

      const UPDATED: SubgraphResponse = {
        nodes: [...SAMPLE.nodes, { id: 'c', type: 'Norma', label: 'C' }],
        edges: SAMPLE.edges,
        metadata: { total_nodes: 3 },
      };
      fetchArticleGraphMock.mockResolvedValue(UPDATED);

      const { result } = renderHook(() => useArticleGraph('urn:a'));
      // Instant serve: settled 'success' with the cached payload BEFORE the
      // background revalidation resolves.
      expect(result.current.status).toBe('success');
      if (result.current.status !== 'success') throw new Error('expected success');
      expect(result.current.data).toEqual(SAMPLE);
      // The background revalidation still fired…
      expect(fetchArticleGraphMock).toHaveBeenCalledTimes(2);
      // …and swaps in the changed payload once it lands.
      await waitFor(() => {
        if (result.current.status !== 'success') throw new Error('expected success');
        expect(result.current.data).toEqual(UPDATED);
      });
    });

    it("navigating to a NEW key keeps the previous elements ('revalidating', never a skeleton swap)", async () => {
      let resolveB: ((v: SubgraphResponse) => void) | null = null;
      const bPending = new Promise<SubgraphResponse>((r) => {
        resolveB = r;
      });
      fetchArticleGraphMock.mockResolvedValueOnce(SAMPLE).mockReturnValueOnce(bPending);

      const { result, rerender } = renderHook(({ urn }) => useArticleGraph(urn), {
        initialProps: { urn: 'urn:a' },
      });
      await waitFor(() => expect(result.current.status).toBe('success'));

      rerender({ urn: 'urn:b' });
      const during = result.current;
      expect(during.status).toBe('revalidating');
      if (during.status !== 'revalidating') throw new Error('expected revalidating');
      // The PREVIOUS graph stays available for the always-mounted canvas.
      expect(during.data).toEqual(SAMPLE);
      expect(during.elements.nodes).toHaveLength(2);

      const bResponse: SubgraphResponse = {
        nodes: [{ id: 'b1', type: 'Norma', label: 'B1' }],
        edges: [],
      };
      await act(async () => {
        resolveB?.(bResponse);
      });
      const after = result.current;
      expect(after.status).toBe('success');
      if (after.status !== 'success') throw new Error('expected success');
      expect(after.data).toEqual(bResponse);
    });

    it('does not cache empty subgraphs (the lazy-ingestion trigger must re-run)', async () => {
      const EMPTY: SubgraphResponse = { nodes: [], edges: [] };
      fetchArticleGraphMock.mockResolvedValue(EMPTY);
      const first = renderHook(() => useArticleGraph('urn:empty'));
      await waitFor(() => expect(first.result.current.status).toBe('success'));
      first.unmount();

      const { result } = renderHook(() => useArticleGraph('urn:empty'));
      // No instant serve for an empty entry — full first-load path again.
      expect(result.current.status).toBe('loading');
    });

    it('keeps the cached graph (and logs) when a background revalidation fails', async () => {
      fetchArticleGraphMock.mockResolvedValueOnce(SAMPLE);
      const first = renderHook(() => useArticleGraph('urn:a'));
      await waitFor(() => expect(first.result.current.status).toBe('success'));
      first.unmount();

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        fetchArticleGraphMock.mockRejectedValueOnce(new Error('down'));
        const { result } = renderHook(() => useArticleGraph('urn:a'));
        expect(result.current.status).toBe('success');
        await waitFor(() => expect(errorSpy).toHaveBeenCalled());
        // Still the stale-but-valid cached graph, never 'error'.
        expect(result.current.status).toBe('success');
        if (result.current.status !== 'success') throw new Error('expected success');
        expect(result.current.data).toEqual(SAMPLE);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('normalizes the !vig= version marker into the same cache key (gotcha #6)', async () => {
      fetchArticleGraphMock.mockResolvedValue(SAMPLE);
      const first = renderHook(() => useArticleGraph('urn:x~art2043'));
      await waitFor(() => expect(first.result.current.status).toBe('success'));
      first.unmount();

      const { result } = renderHook(() => useArticleGraph('urn:x~art2043!vig='));
      // Instant serve from the marker-less entry.
      expect(result.current.status).toBe('success');
    });

    it('keeps reference stability when a revalidation returns an identical payload', async () => {
      // Fresh clone per call: equality must be structural, not referential.
      fetchArticleGraphMock.mockImplementation(() =>
        Promise.resolve(JSON.parse(JSON.stringify(SAMPLE)) as SubgraphResponse)
      );

      const { result } = renderHook(() => useArticleGraph('urn:a'));
      await waitFor(() => expect(result.current.status).toBe('success'));
      if (result.current.status !== 'success') throw new Error('expected success');
      const dataBefore = result.current.data;
      const elementsBefore = result.current.elements;

      await act(async () => {
        result.current.refetch();
      });
      await waitFor(() => expect(result.current.status).toBe('success'));
      if (result.current.status !== 'success') throw new Error('expected success');
      // Same payload → the hook hands back the SAME references (memo stability).
      expect(result.current.data).toBe(dataBefore);
      expect(result.current.elements).toBe(elementsBefore);
    });
  });
});
