import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../EnvironmentContentViewer', () => ({ EnvironmentContentViewer: () => null }));
vi.mock('../../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { fetchDecisionCached } from '../../../../utils/decisionFetchCache';
import { CreateEnvironmentModal } from '../CreateEnvironmentModal';
import { articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from '../../../../test/fixtures/travelFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
});

describe('CreateEnvironmentModal: a private save keeps every anchor', () => {
  it('hands on the whole selection, decision anchors included, with no notice', async () => {
    const onCreate = vi.fn();
    render(
      <CreateEnvironmentModal
        isOpen
        onClose={vi.fn()}
        onCreate={onCreate}
        currentState={{ dossiers: [], quickNorms: [], customAliases: [], annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight] }}
      />,
    );
    expect(screen.queryByText(/non incluse/)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/DPO Compliance/), { target: { value: 'Prova' } });
    fireEvent.click(screen.getByRole('button', { name: /^Crea/ }));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    const selection = onCreate.mock.calls[0][1];
    expect(selection.annotationIds).toEqual(['n-dec', 'n-art']);
    expect(selection.highlightIds).toEqual(['h-dec', 'h-art']);
  });
});
