import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../services/assistantService', () => ({
  assistantService: {
    features: vi.fn(), listProposals: vi.fn(), setProposalState: vi.fn(), editProposalNote: vi.fn(), removeProposal: vi.fn(), removeProposalOnExit: vi.fn(), refreshForExit: vi.fn(async () => {}),
  },
}));

import { appStore } from '../../../store/useAppStore';
import { assistantService } from '../../../services/assistantService';
import { assistantProposalsStore } from '../../../store/assistantProposals';
import { CurrentDossierContext } from '../dossier/currentDossier';
import { DecisionReadingSurface } from './DecisionReadingSurface';
import { decisionProjection } from '../../../utils/decisionRender';
import { aiNote } from '../../../utils/__fixtures__/assistantNote';
import type { Proposal } from '../../../types';
import { resetNotifications } from '../../ui/notifications/notifications';
import type { DecisionIdentity } from '../../../types/decisions';

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 };
const TESTO = { motivazione: 'Il ricorso è fondato.' };
const PLAIN = decisionProjection(TESTO);
const proposal = (id: string, words: string, note: Proposal['note'], startOffset = PLAIN.indexOf(words)): Proposal => ({
  id, normaKey: 'cassazione:civile:99999:2024::art::', text: words, color: 'yellow', startOffset, endOffset: startOffset + words.length,
  createdAt: '', dossierItemId: 's1', proposedBy: { clientName: 'Claude Code' }, assistantRange: { startOffset, text: words },
  rangeEdited: false, rangeEditedAt: null, rangeEditedBy: null, note,
});
const noted = proposal('p1', 'fondato', aiNote('Il motivo regge.'));
const lost = proposal('p2', 'parole sparite', null, 3);
const textOf = (root: Element) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out += n.nodeValue;
  return out;
};
const renderSurface = (itemId?: string) => render(
  <CurrentDossierContext.Provider value="d1">
    <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} dossierItemId={itemId} />
  </CurrentDossierContext.Provider>,
);

afterEach(() => resetNotifications());

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({
    highlights: [], annotations: [], loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(), removeHighlight: vi.fn(),
  });
  assistantProposalsStore.setState({ enabled: true, byItem: {} });
  vi.mocked(assistantService.listProposals).mockResolvedValue([noted, lost]);
  vi.mocked(assistantService.setProposalState).mockResolvedValue({ ...noted, note: aiNote('Il motivo regge.', 'validated') });
});

describe('DecisionReadingSurface — what an application proposed on its dossier entry (D7b)', () => {
  it('draws it dashed, names it on the sign, and the text nodes still spell the projection', async () => {
    const { container } = renderSurface('s1');
    await waitFor(() => expect(container.querySelector('[data-highlight="p1"]')).not.toBeNull());
    expect(assistantService.listProposals).toHaveBeenCalledWith('d1', 's1');
    expect(container.querySelector('[data-highlight="p1"]')).toHaveAttribute('data-proposed', 'proposed');
    expect(container.querySelector('.vlx-sign')?.getAttribute('aria-label')).toBe("1 passaggio proposto dall'IA: 1 da validare");
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(PLAIN);
    expect(appStore.getState().highlights).toEqual([]);
  });

  it('its popover validates the note through the entry\'s route', async () => {
    const { container } = renderSurface('s1');
    const sign = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('.vlx-sign[data-proposed]');
      if (!found) throw new Error('no sign yet');
      return found;
    });
    fireEvent.click(sign);
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni/ });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: "Proposto dall'IA, confermi?" }));
    await waitFor(() => expect(assistantService.setProposalState).toHaveBeenCalledWith('d1', 's1', 'p1', 'validated', undefined));
  });

  it('one whose words are not there is listed under the text and removed through its route', async () => {
    renderSurface('s1');
    const box = await screen.findByRole('region', { name: "Proposte dell'IA non più nel testo (1)" });
    expect(screen.queryByRole('region', { name: /Non ritrovate/ })).toBeNull();
    fireEvent.click(within(box).getByRole('button', { name: 'Rimuovi il passaggio' }));
    await waitFor(() => expect(assistantProposalsStore.getState().byItem.s1.map((p) => p.id)).toEqual(['p1']));
    expect(appStore.getState().removeHighlight).not.toHaveBeenCalled();
  });

  it('read outside a dossier entry, it asks nothing and draws none', async () => {
    const { container } = renderSurface(undefined);
    await waitFor(() => expect(container.querySelector('.vlx-decision')).not.toBeNull());
    expect(assistantService.listProposals).not.toHaveBeenCalled();
    expect(container.querySelector('[data-proposed]')).toBeNull();
  });
});
