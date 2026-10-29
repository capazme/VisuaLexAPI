import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('../services/assistantService', () => ({
  assistantService: { listProposals: vi.fn(async () => []), moveProposal: vi.fn(), features: vi.fn() },
}));

import { useEntryProposals } from './useEntryProposals';
import { assistantProposalsStore } from '../store/assistantProposals';
import { CurrentDossierContext } from '../components/features/dossier/currentDossier';
import type { Proposal } from '../types';

const proposal = (id: string, itemId: string): Proposal => ({
  id, normaKey: 'k::art::1', text: 'parole', color: 'yellow', startOffset: 0, endOffset: 6, createdAt: '', dossierItemId: itemId,
  proposedBy: { clientName: 'Claude Code' }, assistantRange: { startOffset: 0, text: 'parole' }, rangeEdited: false, rangeEditedAt: null,
  rangeEditedBy: null, note: null,
});

const wrapper = ({ children }: { children: ReactNode }) => <CurrentDossierContext.Provider value="d1">{children}</CurrentDossierContext.Provider>;

describe('useEntryProposals — «Sposta l\'evidenziazione»', () => {
  it('one passage moves at a time on the page: starting another ends the first reader\'s bar', () => {
    assistantProposalsStore.setState({ enabled: true, byItem: { a1: [proposal('p1', 'a1')], a2: [proposal('p2', 'a2')] }, moving: null });
    const first = renderHook(() => useEntryProposals('a1', 'k', '1'), { wrapper });
    const second = renderHook(() => useEntryProposals('a2', 'k', '1'), { wrapper });
    act(() => first.result.current.actions!.move!('p1'));
    expect(first.result.current.moving?.id).toBe('p1');
    act(() => second.result.current.actions!.move!('p2'));
    expect(second.result.current.moving?.id).toBe('p2');
    expect(first.result.current.moving).toBeNull();
    act(() => second.result.current.cancelMove());
    expect(assistantProposalsStore.getState().moving).toBeNull();
  });

  it('a passage removed while it moves ends the move, and its «Annulla» does not bring the bar back', () => {
    assistantProposalsStore.setState({ enabled: true, byItem: { a1: [proposal('p1', 'a1')] }, moving: null });
    const reader = renderHook(() => useEntryProposals('a1', 'k', '1'), { wrapper });
    act(() => reader.result.current.actions!.move!('p1'));
    act(() => assistantProposalsStore.setState({ byItem: { a1: [] } }));
    expect(reader.result.current.moving).toBeNull();
    expect(assistantProposalsStore.getState().moving).toBeNull();
    act(() => assistantProposalsStore.setState({ byItem: { a1: [proposal('p1', 'a1')] } }));
    expect(reader.result.current.moving).toBeNull();
  });

  it('a reader that goes with its bar open ends the move: opened again, no bar comes back by itself', () => {
    assistantProposalsStore.setState({ enabled: true, byItem: { a1: [proposal('p1', 'a1')] }, moving: null });
    const reader = renderHook(() => useEntryProposals('a1', 'k', '1'), { wrapper });
    act(() => reader.result.current.actions!.move!('p1'));
    expect(reader.result.current.moving?.id).toBe('p1');
    reader.unmount();
    expect(assistantProposalsStore.getState().moving).toBeNull();
    const again = renderHook(() => useEntryProposals('a1', 'k', '1'), { wrapper });
    expect(again.result.current.moving).toBeNull();
  });

  it('a reader of another entry that goes leaves the move alone', () => {
    assistantProposalsStore.setState({ enabled: true, byItem: { a1: [proposal('p1', 'a1')], a2: [] }, moving: null });
    const reader = renderHook(() => useEntryProposals('a1', 'k', '1'), { wrapper });
    const other = renderHook(() => useEntryProposals('a2', 'k', '1'), { wrapper });
    act(() => reader.result.current.actions!.move!('p1'));
    other.unmount();
    expect(assistantProposalsStore.getState().moving).toEqual({ itemId: 'a1', proposalId: 'p1' });
  });
});
