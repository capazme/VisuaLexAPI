import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: vi.fn() }));
vi.mock('../../../services/assistantService', () => ({
  assistantService: {
    features: vi.fn(), listProposals: vi.fn(), setProposalState: vi.fn(), editProposalNote: vi.fn(), moveProposal: vi.fn(), removeProposal: vi.fn(), removeProposalOnExit: vi.fn(), refreshForExit: vi.fn(async () => {}),
  },
}));

import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { DossierItemReader } from './DossierItemReader';
import { appStore } from '../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import type { NormaVisitata, Proposal } from '../../../types';
import { assistantService } from '../../../services/assistantService';
import { assistantProposalsStore } from '../../../store/assistantProposals';
import { CurrentDossierContext } from './currentDossier';
import { aiNote } from '../../../utils/__fixtures__/assistantNote';
import { notificationStore, resetNotifications } from '../../ui/notifications/notifications';
import { GLOSS_WORDS } from '../../../constants/glossWords';

const norma: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1453' };
const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const at = (words: string) => PLAIN.indexOf(words);

const proposal = (id: string, words: string, over: Partial<Proposal> = {}): Proposal => ({
  id, kind: 'gloss', normaKey: `${buildItemKey(norma)}::art::${uniqueArticleIdFromNorma(norma)}`, text: words, color: null,
  startOffset: at(words), endOffset: at(words) + words.length, createdAt: '2026-10-29T09:00:00Z', dossierItemId: 'a1',
  proposedBy: { clientName: 'Claude Code' }, assistantRange: { startOffset: at(words), text: words },
  rangeEdited: false, rangeEditedAt: null, rangeEditedBy: null, note: aiNote('La parte che ha adempiuto può scegliere.'),
  ...over,
});
const gloss = proposal('g1', 'contraenti');
const mark: Proposal = { ...proposal('p1', 'obbligazioni'), kind: 'mark', color: 'green', note: aiNote('Il presupposto.') };
const lost: Proposal = { ...proposal('g2', 'parole che non ci sono'), startOffset: 12 };

const renderReader = () => render(
  <CurrentDossierContext.Provider value="d1">
    <DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} itemId="a1" />
  </CurrentDossierContext.Provider>,
);
const signOf = async (container: HTMLElement, block: number) => waitFor(() => {
  const found = container.querySelector<HTMLElement>(`.vlx-sign[data-block="${block}"]`);
  if (!found || found.dataset.glosses === '0') throw new Error('no sign yet');
  return found;
});

describe('DossierItemReader — an application\'s glosses (D8)', () => {
  beforeEach(() => {
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma });
    vi.mocked(assistantService.listProposals).mockResolvedValue([gloss, mark, lost]);
    vi.mocked(assistantService.removeProposal).mockResolvedValue();
    vi.mocked(assistantService.setProposalState).mockImplementation(async (_d, _i, id, state) => ({
      ...(id === 'g1' ? gloss : lost), note: aiNote('La parte che ha adempiuto può scegliere.', state),
    }));
    appStore.setState({ highlights: [], annotations: [] });
    assistantProposalsStore.setState({ enabled: true, byItem: {} });
  });

  afterEach(() => {
    resetNotifications();
    // The width spies only: the service's mocks keep their shape for the next test.
    vi.restoreAllMocks();
  });

  it('a gloss is never a mark in the text: its block\'s sign counts it, the coloured proposal stays a mark', async () => {
    const { container } = renderReader();
    const sign = await signOf(container, 2);
    expect(container.querySelector('[data-highlight="g1"]')).toBeNull();
    expect(container.querySelector('[data-highlight="p1"]')).not.toBeNull();
    expect(sign.getAttribute('aria-label')).toContain(`${GLOSS_WORDS.count(1)}: 1 da validare`);
    expect(sign.querySelector('.vlx-sign-gloss[data-state="proposed"]')).not.toBeNull();
    // The text is the text (root rule 23), and nothing of it entered the app's highlights.
    expect(container.querySelector('.vlx-art')?.textContent).toBe(PLAIN);
    expect(appStore.getState().highlights).toEqual([]);
  });

  it('narrow (no column): the sign opens its popover with the gloss\'s card, «Valida» through the entry\'s route', async () => {
    const { container } = renderReader();
    fireEvent.click(await signOf(container, 2));
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Nei contratti/ });
    const card = within(dialog).getByRole('article', { name: /Da validare/ });
    expect(within(card).getByText('La parte che ha adempiuto può scegliere.')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Valida' }));
    await waitFor(() => expect(assistantService.setProposalState).toHaveBeenCalledWith('d1', 'a1', 'g1', 'validated', undefined));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Valida' })).toHaveAttribute('aria-pressed', 'true'));
    // The column is drawn (a container query hides it): its cards wait, unplaced, for room.
    expect(container.querySelector('.vlx-gloss-column')).not.toBeNull();
  });

  it('a gloss whose words are not in the text is listed under it, with its actions', async () => {
    renderReader();
    const list = await screen.findByRole('region', { name: `${GLOSS_WORDS.lostTitle} (1)` });
    fireEvent.click(within(list).getByRole('button', { name: 'Da rivedere' }));
    await waitFor(() => expect(assistantService.setProposalState).toHaveBeenCalledWith('d1', 'a1', 'g2', 'review', undefined));
  });

  it('«Rimuovi» takes the card away at once and offers «Annulla» under the gloss\'s own words', async () => {
    const { container } = renderReader();
    fireEvent.click(await signOf(container, 2));
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Nei contratti/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rimuovi' }));
    expect(notificationStore.getState().entries.at(-1)).toMatchObject({ message: GLOSS_WORDS.removed, undoable: true });
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).not.toContain('g1');
    expect(assistantService.removeProposal).not.toHaveBeenCalled();
  });

  it('wide (the column has room): the card stands beside the text and the sign focuses it, no popover', async () => {
    // jsdom lays nothing out: the column is «shown» when it has a width.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('vlx-gloss-column') ? 280 : 0;
    });
    const { container } = renderReader();
    const column = await screen.findByRole('complementary', { name: GLOSS_WORDS.column });
    const card = await waitFor(() => {
      const found = within(column).getByRole('article', { name: /Da validare/ });
      if (found.classList.contains('invisible')) throw new Error('not placed yet');
      return found;
    });
    expect(card.style.transform).toMatch(/^translateY\(\d+px\)$/);
    fireEvent.click(await signOf(container, 2));
    // The block holds a coloured proposal too: the popover opens, with the way to the gloss in the margin.
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Nei contratti/ });
    expect(within(dialog).queryByRole('article', { name: /Da validare/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: GLOSS_WORDS.goTo(1) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(card);
  });

  it('wide, a block with glosses only: its sign focuses the card and opens nothing', async () => {
    vi.mocked(assistantService.listProposals).mockResolvedValue([gloss]);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('vlx-gloss-column') ? 280 : 0;
    });
    const { container } = renderReader();
    const column = await screen.findByRole('complementary', { name: GLOSS_WORDS.column });
    const card = await waitFor(() => within(column).getByRole('article', { name: /Da validare/ }));
    await waitFor(() => expect(card.classList.contains('invisible')).toBe(false));
    fireEvent.click(await signOf(container, 2));
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
