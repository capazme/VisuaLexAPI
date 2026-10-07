import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: { publish: vi.fn(async () => ({})) },
}));
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { appStore } from '../../../store/useAppStore';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { fetchDecisionCached } from '../../../utils/decisionFetchCache';
import { PublishEnvironmentModal } from './PublishEnvironmentModal';
import { NOTICE, articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from '../environments/__tests__/travelFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
  appStore.setState({
    environments: [{
      id: 'e1', name: 'Ambiente di prova', createdAt: '', dossiers: [], quickNorms: [], customAliases: [],
      annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight],
    }] as never,
  });
});

describe('PublishEnvironmentModal: words a court withdrew do not go to the Forum', () => {
  it('publishes without the decision\'s anchors and says so', async () => {
    render(<PublishEnvironmentModal onClose={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'e1' } });
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pubblica/ }));
    await vi.waitFor(() => expect(sharedEnvironmentService.publish).toHaveBeenCalledOnce());
    const { content } = vi.mocked(sharedEnvironmentService.publish).mock.calls[0][0] as { content: { annotations: Array<{ id: string }>; highlights: Array<{ id: string }> } };
    expect(content.annotations.map((a) => a.id)).toEqual(['n-art']);
    expect(content.highlights.map((h) => h.id)).toEqual(['h-art']);
  });
});
