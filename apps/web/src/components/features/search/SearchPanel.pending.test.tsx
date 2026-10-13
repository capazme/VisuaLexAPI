import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../practice/ReadingRow', () => ({ ReadingRow: () => null }));
vi.mock('../practice/PracticeBar', () => ({ PracticeBar: () => null }));
vi.mock('../practice/PracticePhoneView', () => ({ PracticePhoneView: () => null }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./ReadingBackControl', () => ({ ReadingBackControl: () => null }));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };
const decisions = () => appStore.getState().practices.flatMap((p) => p.decisions);

beforeEach(() => appStore.setState({ practices: [], activePracticeId: null, pendingDecision: null }));

// The `/sentenze/…` address queues a decision and redirects: the panel may mount before or after
// the request, and StrictMode runs every effect twice.
describe('SearchPanel — a decision asked for from outside', () => {
  it('opens it once when the request was there before the panel mounted', () => {
    appStore.getState().requestOpenDecision(REF);
    render(<StrictMode><MemoryRouter><SearchPanel /></MemoryRouter></StrictMode>);
    expect(decisions()).toHaveLength(1);
    expect(appStore.getState().pendingDecision).toBeNull();
  });

  it('opens it once when the request comes after the panel mounted', () => {
    render(<StrictMode><MemoryRouter><SearchPanel /></MemoryRouter></StrictMode>);
    expect(decisions()).toHaveLength(0);
    act(() => { appStore.getState().requestOpenDecision(REF); });
    expect(decisions()).toHaveLength(1);
    expect(appStore.getState().pendingDecision).toBeNull();
  });
});
