import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchHistoryMock = vi.fn();
const fetchPendingMock = vi.fn();
const fetchContribJobsMock = vi.fn();
const fetchProfileMock = vi.fn();
const getHealthMock = vi.fn();

vi.mock('../../qa/qaApi', () => ({ fetchHistory: (...a: unknown[]) => fetchHistoryMock(...a) }));
vi.mock('../../validate/validateApi', () => ({
  fetchPendingQueue: (...a: unknown[]) => fetchPendingMock(...a),
}));
vi.mock('../../contrib/contribApi', () => ({
  fetchMyContribJobs: (...a: unknown[]) => fetchContribJobsMock(...a),
}));
vi.mock('../../../../services/merltService', () => ({
  fetchMerltProfile: (...a: unknown[]) => fetchProfileMock(...a),
  getMerltHealth: (...a: unknown[]) => getHealthMock(...a),
}));

import { useHubData, type HubGates } from '../useHubData';

const allGates: HubGates = { qaAskable: true, canValidate: true, canContribute: true, graphReadable: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchHistoryMock.mockResolvedValue([]);
  fetchPendingMock.mockResolvedValue({
    pending_entities: [], pending_relations: [], total_entities: 0, total_relations: 0, user_can_vote: 0,
  });
  fetchContribJobsMock.mockResolvedValue({ jobs: [] });
  fetchProfileMock.mockResolvedValue({
    userId: 'u', authorityScore: 0.5, baselineQual: 'q', trackRecord: 0, performance: 0,
    totalContributions: 0, syncedAt: '',
  });
  getHealthMock.mockResolvedValue({ bff: 'ok', merlt: 'reachable', upstream: {} });
});

describe('useHubData', () => {
  it('fires no fetches when disabled', () => {
    renderHook(() => useHubData(false, allGates));
    expect(fetchHistoryMock).not.toHaveBeenCalled();
    expect(fetchPendingMock).not.toHaveBeenCalled();
    expect(fetchContribJobsMock).not.toHaveBeenCalled();
    expect(fetchProfileMock).not.toHaveBeenCalled();
    expect(getHealthMock).not.toHaveBeenCalled();
  });

  it('marks gated slices without hitting the network when the level is too low', async () => {
    const { result } = renderHook(() =>
      useHubData(true, { qaAskable: false, canValidate: false, canContribute: false, graphReadable: false }),
    );
    expect(fetchHistoryMock).not.toHaveBeenCalled();
    expect(fetchPendingMock).not.toHaveBeenCalled();
    expect(fetchContribJobsMock).not.toHaveBeenCalled();
    expect(getHealthMock).not.toHaveBeenCalled();
    // profile is always fetched when enabled
    await waitFor(() => expect(result.current.profile.status).toBe('success'));
    expect(result.current.lastQa).toEqual({ status: 'gated' });
    expect(result.current.pendingCount).toEqual({ status: 'gated' });
    expect(result.current.lastContrib).toEqual({ status: 'gated' });
    expect(result.current.health).toEqual({ status: 'gated' });
  });

  it('collapses pending entities + relations into a single count', async () => {
    fetchPendingMock.mockResolvedValue({
      pending_entities: [{ id: 'a' }, { id: 'b' }],
      pending_relations: [{ id: 'c' }],
      total_entities: 2, total_relations: 1, user_can_vote: 3,
    });
    const { result } = renderHook(() => useHubData(true, allGates));
    await waitFor(() => expect(result.current.pendingCount.status).toBe('success'));
    expect(result.current.pendingCount).toEqual({ status: 'success', data: 3 });
  });

  it('is fail-soft per slice: one failing endpoint does not poison the others', async () => {
    fetchPendingMock.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useHubData(true, allGates));
    await waitFor(() => expect(result.current.pendingCount.status).toBe('error'));
    // the rest still resolve
    await waitFor(() => expect(result.current.profile.status).toBe('success'));
    expect(result.current.lastQa.status).toBe('success');
    expect(result.current.health.status).toBe('success');
  });

  it('reads reachability + a node count from the health payload when present', async () => {
    getHealthMock.mockResolvedValue({
      bff: 'ok', merlt: 'reachable', upstream: { graph: { nodes: 27700 } },
    });
    const { result } = renderHook(() => useHubData(true, allGates));
    await waitFor(() => expect(result.current.health.status).toBe('success'));
    expect(result.current.health).toEqual({ status: 'success', data: { reachable: true, nodeCount: 27700 } });
  });

  it('flags unreachable when health reports merlt !== reachable', async () => {
    getHealthMock.mockResolvedValue({ bff: 'ok', merlt: 'unreachable', error: 'x' });
    const { result } = renderHook(() => useHubData(true, allGates));
    await waitFor(() => expect(result.current.health.status).toBe('success'));
    expect(result.current.health).toEqual({ status: 'success', data: { reachable: false, nodeCount: null } });
  });

  it('exposes the most-recent Q&A turn (first history item)', async () => {
    fetchHistoryMock.mockResolvedValue([{ trace_id: 't', query: 'Q?', synthesis: 's', mode: 'convergent', experts_used: [], sources: [] }]);
    const { result } = renderHook(() => useHubData(true, allGates));
    await waitFor(() => expect(result.current.lastQa.status).toBe('success'));
    expect(result.current.lastQa).toMatchObject({ status: 'success', data: { query: 'Q?' } });
    expect(fetchHistoryMock).toHaveBeenCalledWith(1);
  });
});
