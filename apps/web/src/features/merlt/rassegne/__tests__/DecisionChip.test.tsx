import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../../store/useAppStore';
import { DecisionChip } from '../DecisionChip';
import type { RassegnaPronuncia } from '../types';

vi.mock('../../../../utils/decisionFetchCache', () => ({
  fetchDecisionCached: () => Promise.resolve({ esito: 'non_trovata', motivo: 'inesistente' }),
}));

const PRONUNCIA: RassegnaPronuncia = {
  key: 'cassazione:civile:1234:2024', label: 'Sez. U, n. 1234/2024', corte: 'cassazione',
  archivio: 'civile', numero: 1234, anno: 2024, sezione: 'U', rv: [],
};
const BACK = { tabId: 't1', blockId: 'b1', articleId: 'a1', label: 'art. 2043 c.c.' };

const openDecision = vi.fn(() => 'tab');
const pushReadingBack = vi.fn();
beforeEach(() => {
  openDecision.mockClear();
  pushReadingBack.mockClear();
  appStore.setState({ openDecision, pushReadingBack } as never);
});

describe('DecisionChip', () => {
  it('previews the decision, then opens it beside the article and records the way back', async () => {
    render(<MemoryRouter initialEntries={['/']}><DecisionChip pronuncia={PRONUNCIA} besideId="t1" backEntry={BACK} /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByRole('link')); });
    expect(openDecision).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apri accanto' }));
    expect(pushReadingBack).toHaveBeenCalledWith(BACK);
    expect(openDecision).toHaveBeenCalledWith(expect.objectContaining({ corte: 'cassazione', numero: 1234, anno: 2024 }), { fromLink: true, besideId: 't1' });
  });
});
