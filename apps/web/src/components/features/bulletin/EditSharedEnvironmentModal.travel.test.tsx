import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../environments/EnvironmentContentViewer', () => ({ EnvironmentContentViewer: () => null }));
vi.mock('../../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: { updateWithVersion: vi.fn(async () => ({})) },
}));
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { appStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { fetchDecisionCached } from '../../../utils/decisionFetchCache';
import { EditSharedEnvironmentModal } from './EditSharedEnvironmentModal';
import { NOTICE, articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from '../environments/__tests__/travelFixtures';

const shared = { id: 'se', title: 'Forum', description: '', category: 'other', tags: [], includeNotes: true, includeHighlights: true, currentVersion: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
  appStore.setState({
    dossiers: [{ id: 'd1', title: 'Pratica', createdAt: '', items: [] }] as never,
    quickNorms: [], customAliases: [], annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight],
  });
});

describe('EditSharedEnvironmentModal: words a court withdrew do not go to the Forum', () => {
  it('publishes the new version without the decision\'s anchors and says so', async () => {
    render(<EditSharedEnvironmentModal environment={shared as never} onClose={vi.fn()} onUpdated={vi.fn()} />);
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Salva|Pubblica|Aggiorna/ }));
    await vi.waitFor(() => expect(sharedEnvironmentService.updateWithVersion).toHaveBeenCalledOnce());
    const { content } = vi.mocked(sharedEnvironmentService.updateWithVersion).mock.calls[0][1] as { content: { annotations: Array<{ id: string }>; highlights: Array<{ id: string }> } };
    expect(content.annotations.map((a) => a.id)).toEqual(['n-art']);
    expect(content.highlights.map((h) => h.id)).toEqual(['h-art']);
  });
});
