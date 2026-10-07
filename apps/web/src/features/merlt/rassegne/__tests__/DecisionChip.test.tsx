import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../../store/useAppStore';
import { DecisionChip } from '../DecisionChip';
import type { RassegnaPronuncia } from '../types';

const PRONUNCIA: RassegnaPronuncia = {
  key: 'cassazione:civile:1234:2024', label: 'Sez. U, n. 1234/2024', corte: 'cassazione',
  archivio: 'civile', numero: 1234, anno: 2024, sezione: 'U', rv: [],
};
const BACK = { tabId: 't1', blockId: 'b1', articleId: 'a1', label: 'art. 2043 c.c.' };

const openDecisionTab = vi.fn(() => 'tab');
const pushReadingBack = vi.fn();
beforeEach(() => {
  openDecisionTab.mockClear();
  pushReadingBack.mockClear();
  appStore.setState({ openDecisionTab, pushReadingBack } as never);
});

describe('DecisionChip', () => {
  it('opens the decision beside the article and records the way back', () => {
    render(<MemoryRouter initialEntries={['/']}><DecisionChip pronuncia={PRONUNCIA} besideTabId="t1" backEntry={BACK} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('link'));
    expect(pushReadingBack).toHaveBeenCalledWith(BACK);
    expect(openDecisionTab).toHaveBeenCalledWith(expect.objectContaining({ corte: 'cassazione', numero: 1234, anno: 2024 }), { besideTabId: 't1' });
  });
});
