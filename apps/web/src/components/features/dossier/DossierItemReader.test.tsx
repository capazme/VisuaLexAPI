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
import type { Highlight, NormaVisitata, Proposal } from '../../../types';
import { assistantService } from '../../../services/assistantService';
import { assistantProposalsStore } from '../../../store/assistantProposals';
import { CurrentDossierContext } from './currentDossier';
import { aiNote } from '../../../utils/__fixtures__/assistantNote';
import { resetNotifications } from '../../ui/notifications/notifications';

const norma: NormaVisitata = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1453' };
const RAW = fixtureText('nrm-cc-1453');
const PLAIN = RAW.replace(/\n/g, '');
const highlight: Highlight = {
  id: 'h1',
  normaKey: buildItemKey(norma),
  articleId: uniqueArticleIdFromNorma(norma),
  rangeSerialized: '',
  text: 'risarcimento del danno',
  color: 'green',
  startOffset: PLAIN.indexOf('risarcimento del danno'),
};

describe('DossierItemReader — annotations on the text', () => {
  beforeEach(() => {
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma });
  });

  it('marks the annotated comma with a sign that opens its annotations, where a highlight is removed', async () => {
    const removeHighlight = vi.fn();
    appStore.setState({ highlights: [highlight], annotations: [], removeHighlight });
    const { container } = render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    const sign = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('.vlx-sign[data-block="2"]');
      if (!found) throw new Error('no sign yet');
      return found;
    });
    fireEvent.click(sign);
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Nei contratti/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rimuovi/ }));
    expect(removeHighlight).toHaveBeenCalledWith('h1');
  });

  it('no longer lists the highlights a sign already shows in a box under the text', async () => {
    appStore.setState({ highlights: [highlight], annotations: [] });
    const { container } = render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(screen.queryByText('Evidenziazioni')).toBeNull();
    expect(screen.queryByText('Altre evidenziazioni')).toBeNull();
  });

  it('still lets the reader remove a highlight whose text is no longer there', async () => {
    const removeHighlight = vi.fn();
    const orphan: Highlight = { ...highlight, id: 'gone', text: 'testo che non c\'è più', startOffset: 40 };
    appStore.setState({ highlights: [highlight, orphan], annotations: [], removeHighlight });
    render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    await screen.findByText('Altre evidenziazioni');
    expect(screen.getByText('Non più nel testo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi evidenziazione' }));
    expect(removeHighlight).toHaveBeenCalledWith('gone');
  });
});

describe('DossierItemReader — the colour of new highlights (H1)', () => {
  it('has no bar of its own: the colour is chosen with its actions', async () => {
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma });
    appStore.setState({ highlights: [], annotations: [] });
    render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    const trigger = await screen.findByRole('button', { name: 'Colore: giallo (nuove evidenziazioni)' });
    expect(trigger).toHaveTextContent('Colore: giallo');
  });

  it('offers none on a text read only, which takes no highlight', async () => {
    // A past text: highlights are keyed by article, not by version (`describeVersion`).
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma, validity: { state: 'historical' } as never });
    appStore.setState({ highlights: [], annotations: [] });
    render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
    await screen.findByRole('button', { name: /Copia citazione/ });
    expect(screen.queryByRole('button', { name: /^Colore: / })).toBeNull();
  });
});

describe('DossierItemReader — onArticle', () => {
  it('hands the fetched article to the row, so a row with no rubrica can take it from the text', async () => {
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma });
    appStore.setState({ highlights: [], annotations: [] });
    const onArticle = vi.fn();
    render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} onArticle={onArticle} />);
    await waitFor(() => expect(onArticle).toHaveBeenCalledWith(expect.objectContaining({ article_text: RAW })));
  });
});

describe('DossierItemReader — what an application proposed on the entry (D7b)', () => {
  const at = (words: string) => PLAIN.indexOf(words);
  const proposal = (id: string, words: string, note: Proposal['note']): Proposal => ({
    id, normaKey: `${buildItemKey(norma)}::art::${uniqueArticleIdFromNorma(norma)}`, text: words, color: 'yellow',
    startOffset: at(words), endOffset: at(words) + words.length, createdAt: '2026-10-25T09:00:00Z', dossierItemId: 'a1',
    proposedBy: { clientName: 'Claude Code' }, assistantRange: { startOffset: at(words), text: words },
    rangeEdited: false, rangeEditedAt: null, rangeEditedBy: null, note,
  });
  const noted = proposal('p1', 'contraenti', aiNote('La parte adempiente.'));
  const bare = proposal('p2', 'obbligazioni', null);
  const lost = { ...proposal('p3', 'parole che non ci sono', null), startOffset: 12 };
  const renderReader = (itemId: string | null = 'a1') => render(
    <CurrentDossierContext.Provider value="d1">
      <DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} itemId={itemId ?? undefined} />
    </CurrentDossierContext.Provider>,
  );

  afterEach(() => resetNotifications());

  beforeEach(() => {
    vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: RAW, norma_data: norma });
    vi.mocked(assistantService.listProposals).mockResolvedValue([noted, bare, lost]);
    vi.mocked(assistantService.setProposalState).mockResolvedValue({ ...noted, note: aiNote('La parte adempiente.', 'validated') });
    appStore.setState({ highlights: [], annotations: [] });
    assistantProposalsStore.setState({ enabled: true, byItem: {} });
  });

  it('draws them on its own entry: the noted one dashed, the bare one a plain mark; the sign names the open note', async () => {
    const { container } = renderReader();
    await waitFor(() => expect(container.querySelector('[data-highlight="p1"]')).not.toBeNull());
    expect(assistantService.listProposals).toHaveBeenCalledWith('d1', 'a1');
    expect(container.querySelector('[data-highlight="p1"]')).toHaveAttribute('data-proposed', 'proposed');
    expect(container.querySelector('[data-highlight="p2"]')).not.toHaveAttribute('data-proposed');
    expect(container.querySelector('.vlx-sign[data-block="2"]')?.getAttribute('aria-label')).toContain("1 passaggio proposto dall'IA: 1 da validare");
    // The text is the text.
    expect(container.querySelector('.vlx-art')?.textContent).toContain(PLAIN.slice(0, 40));
    // Never in the app's own highlights.
    expect(appStore.getState().highlights).toEqual([]);
  });

  it('its popover validates the note through the entry\'s route', async () => {
    const { container } = renderReader();
    const sign = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('.vlx-sign[data-block="2"]');
      if (!found?.dataset.proposed) throw new Error('no sign yet');
      return found;
    });
    fireEvent.click(sign);
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Nei contratti/ });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: "Proposto dall'IA, confermi?" }));
    await waitFor(() => expect(assistantService.setProposalState).toHaveBeenCalledWith('d1', 'a1', 'p1', 'validated', undefined));
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Validato' })).toBeChecked());
  });

  it('«Sposta l\'evidenziazione»: the popover closes, the passage\'s words are selected, the new ones saved through the entry\'s route', async () => {
    const moved = { ...noted, text: 'i contraenti', startOffset: at('i contraenti'), endOffset: at('i contraenti') + 12, rangeEdited: true };
    vi.mocked(assistantService.moveProposal).mockResolvedValue(moved);
    const { container } = renderReader();
    const sign = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('.vlx-sign[data-block="2"]');
      if (!found?.dataset.proposed) throw new Error('no sign yet');
      return found;
    });
    fireEvent.click(sign);
    const dialog = await screen.findByRole('dialog', { name: /Annotazioni · Nei contratti/ });
    fireEvent.click(within(dialog).getAllByRole('button', { name: "Sposta l'evidenziazione" })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Annotazioni/ })).toBeNull());
    const bar = screen.getByRole('group', { name: "Sposta l'evidenziazione" });
    expect(window.getSelection()!.toString()).toBe('contraenti');
    // The new words, selected in the text root: read as a highlight of the user's is.
    const root = container.querySelector<HTMLElement>('.vlx-art')!;
    const { rangeFromPlainOffsets } = await import('../../../utils/selectionOffset');
    const range = rangeFromPlainOffsets(root, at('i contraenti'), at('i contraenti') + 12)!;
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.click(within(bar).getByRole('button', { name: 'Sposta qui' }));
    await waitFor(() => expect(assistantService.moveProposal).toHaveBeenCalledWith('d1', 'a1', 'p1', at('i contraenti'), 'i contraenti'));
    expect(screen.queryByRole('group', { name: "Sposta l'evidenziazione" })).toBeNull();
    // The text is the text (root rule 23), and the note kept its state.
    await waitFor(() => expect(container.querySelector('[data-highlight="p1"]')?.textContent).toBe('i contraenti'));
    expect(root.textContent).toContain(PLAIN.slice(0, 60));
    expect(assistantProposalsStore.getState().byItem.a1?.find((p) => p.id === 'p1')?.note?.state).toBe('proposed');
  });

  it('a proposal whose words are no longer there is listed under the text at every width, said the application\'s, with its bin', async () => {
    renderReader();
    const list = await screen.findByRole('region', { name: "Proposte dell'IA non più nel testo (1)" });
    expect(list.className).not.toMatch(/(^| )hidden( |$)/);
    // Not among the reader's own, the desktop box.
    expect(screen.queryByText('Altre evidenziazioni')).toBeNull();
    expect(within(list).getByText(/parole che non ci sono/)).toBeInTheDocument();
    expect(within(list).getByText("Evidenziato dall'IA")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Rimuovi il passaggio' }));
    await waitFor(() => expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p1', 'p2']));
  });

  it('a lost one with a note keeps its note and its checkbox there', async () => {
    vi.mocked(assistantService.listProposals).mockResolvedValue([noted, { ...lost, note: aiNote('Era sul comma 2.') }]);
    renderReader();
    const list = await screen.findByRole('region', { name: "Proposte dell'IA non più nel testo (1)" });
    expect(within(list).getByText('Era sul comma 2.')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('checkbox', { name: "Proposto dall'IA, confermi?" }));
    await waitFor(() => expect(assistantService.setProposalState).toHaveBeenCalledWith('d1', 'a1', 'p3', 'validated', undefined));
  });

  it('closed while a removal waits behind «Annulla», it sends that removal at once', async () => {
    vi.mocked(assistantService.removeProposal).mockClear();
    vi.mocked(assistantService.removeProposal).mockResolvedValue();
    const { unmount } = renderReader();
    const list = await screen.findByRole('region', { name: "Proposte dell'IA non più nel testo (1)" });
    fireEvent.click(within(list).getByRole('button', { name: 'Rimuovi il passaggio' }));
    expect(assistantService.removeProposal).not.toHaveBeenCalled();
    unmount();
    expect(assistantService.removeProposal).toHaveBeenCalledWith('d1', 'a1', 'p3');
  });

  it('asks nothing with the feature off, or outside a dossier entry', async () => {
    vi.mocked(assistantService.listProposals).mockClear();
    // Off, even what the store still held is not drawn.
    assistantProposalsStore.setState({ enabled: false, byItem: { a1: [noted] } });
    const { container, unmount } = renderReader();
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('[data-highlight="p1"]')).toBeNull();
    unmount();
    assistantProposalsStore.setState({ enabled: true, byItem: {} });
    const other = renderReader(null);
    await waitFor(() => expect(other.container.querySelector('.vlx-art')).not.toBeNull());
    expect(assistantService.listProposals).not.toHaveBeenCalled();
    expect(other.container.querySelector('[data-proposed]')).toBeNull();
  });
});
