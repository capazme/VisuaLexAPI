import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../environments/EnvironmentContentViewer', () => ({
  EnvironmentContentViewer: ({ onSelectionChange }: { onSelectionChange: (s: unknown) => void }) => (
    <button onClick={() => onSelectionChange({ dossierIds: [], quickNormIds: [], aliasIds: [], annotationIds: ['n-dec', 'n-art'], highlightIds: ['h-dec', 'h-art'] })}>
      Seleziona tutto
    </button>
  ),
}));
vi.mock('../../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: { createSuggestion: vi.fn(async () => ({})) },
}));
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { appStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { fetchDecisionCached } from '../../../utils/decisionFetchCache';
import { SuggestContentModal } from './SuggestContentModal';
import { NOTICE, articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from '../environments/__tests__/travelFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
  appStore.setState({ dossiers: [], quickNorms: [], customAliases: [], annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight] });
});

describe('SuggestContentModal: words a court withdrew are not suggested', () => {
  it('leaves the decision\'s anchors out of the suggestion and says so', async () => {
    render(<SuggestContentModal environment={{ id: 'env', title: 'Forum', user: { username: 'collega' } } as never} onClose={vi.fn()} onSuggested={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona tutto' }));
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await vi.waitFor(() => expect(sharedEnvironmentService.createSuggestion).toHaveBeenCalledOnce());
    const { items } = vi.mocked(sharedEnvironmentService.createSuggestion).mock.calls[0][1] as { items: Array<{ itemType: string; payload: { normaKey: string } }> };
    expect(items.map((i) => [i.itemType, i.payload.normaKey])).toEqual([['annotation', 'codice-civile'], ['highlight', 'codice-civile']]);
  });
});
