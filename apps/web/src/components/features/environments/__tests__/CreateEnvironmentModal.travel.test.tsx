import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../EnvironmentContentViewer', () => ({ EnvironmentContentViewer: () => null }));
vi.mock('../../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));

import { fetchDecisionCached } from '../../../../utils/decisionFetchCache';
import { CreateEnvironmentModal } from '../CreateEnvironmentModal';
import { NOTICE, articleHighlight, articleNote, decisionHighlight, decisionNote, obscuredAnswer } from './travelFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDecisionCached).mockResolvedValue(obscuredAnswer as never);
});

describe('CreateEnvironmentModal: words a court withdrew do not enter the new environment', () => {
  it('hands on a selection without the decision\'s anchors and says so', async () => {
    const onCreate = vi.fn();
    render(
      <CreateEnvironmentModal
        isOpen
        onClose={vi.fn()}
        onCreate={onCreate}
        currentState={{ dossiers: [], quickNorms: [], customAliases: [], annotations: [decisionNote, articleNote], highlights: [decisionHighlight, articleHighlight] }}
      />,
    );
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/DPO Compliance/), { target: { value: 'Prova' } });
    fireEvent.click(screen.getByRole('button', { name: /^Crea/ }));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    const selection = onCreate.mock.calls[0][1];
    expect(selection.annotationIds).toEqual(['n-art']);
    expect(selection.highlightIds).toEqual(['h-art']);
  });

  it('creates one environment however many times the button is pressed while it waits', async () => {
    let release: (v: never) => void = () => {};
    vi.mocked(fetchDecisionCached).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const onCreate = vi.fn();
    render(
      <CreateEnvironmentModal
        isOpen
        onClose={vi.fn()}
        onCreate={onCreate}
        currentState={{ dossiers: [], quickNorms: [], customAliases: [], annotations: [decisionNote], highlights: [] }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/DPO Compliance/), { target: { value: 'Prova' } });
    const button = screen.getByRole('button', { name: /^Crea/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    release(obscuredAnswer as never);
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  });
});
