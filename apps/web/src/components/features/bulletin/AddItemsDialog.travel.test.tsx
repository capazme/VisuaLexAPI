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
  sharedEnvironmentService: { addSuggestionItems: vi.fn(async () => ({})) },
}));
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { appStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { fetchDecisionCached } from '../../../utils/decisionFetchCache';
import { AddItemsDialog } from './AddItemsDialog';
import { NOTICE, articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from '../environments/__tests__/travelFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
  appStore.setState({ dossiers: [], quickNorms: [], customAliases: [], annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight] });
});

describe('AddItemsDialog: words a court withdrew are not offered', () => {
  it('leaves the decision\'s anchors out of the items and says so', async () => {
    render(<AddItemsDialog suggestionId="sug" onAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona tutto' }));
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi$/ }));
    await vi.waitFor(() => expect(sharedEnvironmentService.addSuggestionItems).toHaveBeenCalledOnce());
    const { items } = vi.mocked(sharedEnvironmentService.addSuggestionItems).mock.calls[0][1] as { items: Array<{ itemType: string; payload: { normaKey: string } }> };
    expect(items.map((i) => [i.itemType, i.payload.normaKey])).toEqual([['annotation', 'codice-civile'], ['highlight', 'codice-civile']]);
  });
});
