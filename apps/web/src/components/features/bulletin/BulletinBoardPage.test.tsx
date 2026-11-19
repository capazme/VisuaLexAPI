import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SharedEnvironment } from '../../../types';
import { loadStudyPacks } from '../../../utils/studyPacks';
import { appStore } from '../../../store/useAppStore';

const service = vi.hoisted(() => ({
  list: vi.fn(),
  getMyShared: vi.fn(async () => []),
  getReceivedSuggestions: vi.fn(async () => []),
  getSentSuggestions: vi.fn(async () => []),
  getPendingSuggestionsCount: vi.fn(async () => 0),
  createSuggestion: vi.fn(),
  report: vi.fn(async () => {}),
}));
vi.mock('../../../services/sharedEnvironmentService', () => ({ sharedEnvironmentService: service }));
vi.mock('../../../services/notificationService', () => ({ notificationService: { markRead: vi.fn(async () => {}) } }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));

import { BulletinBoardPage } from './BulletinBoardPage';

beforeAll(async () => {
  await loadStudyPacks();
});

function env(id: string, title: string, category: SharedEnvironment['category'] = 'civil'): SharedEnvironment {
  return {
    id, title, description: '', category, tags: [], includeNotes: false, includeHighlights: false,
    content: { dossiers: [], quickNorms: [], customAliases: [], annotations: [], highlights: [] },
    viewCount: 0, downloadCount: 0, likeCount: 0, currentVersion: 1, isActive: true,
    user: { id: 'u2', username: 'marta' }, userLiked: false, isOwner: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

const answer = (data: SharedEnvironment[]) => ({ data, pagination: { page: 1, limit: 12, total: data.length, pages: 1 } });

beforeEach(() => {
  vi.clearAllMocks();
  // The list asked for (12 a page) by its order and category; the «I più aggiunti» block reads 3 and is left empty.
  service.list.mockImplementation(async (params: { sort?: string; category?: string; limit?: number }) => {
    if (params.limit === 3) return answer([]);
    if (params.category === 'penal') return answer([env('p1', 'Il reato omissivo', 'penal')]);
    return answer(params.sort === 'popular' ? [env('b', 'Più votato'), env('a', 'Recente')] : [env('a', 'Recente'), env('b', 'Più votato')]);
  });
});

const page = () => render(<MemoryRouter><BulletinBoardPage /></MemoryRouter>);
const titles = () => screen.getAllByRole('article').map((card) => within(card).getByRole('heading').textContent);

describe('BulletinBoardPage - the order and the category change the list', () => {
  it('reads the list again in the order chosen in the row', async () => {
    page();
    await waitFor(() => expect(titles()).toEqual(['Recente', 'Più votato']));
    fireEvent.click(screen.getByRole('radio', { name: 'Popolari' }));
    await waitFor(() => expect(titles()).toEqual(['Più votato', 'Recente']));
    expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'popular' }));
    expect(screen.getByRole('radio', { name: 'Popolari' })).toHaveAttribute('aria-checked', 'true');
  });

  it('narrows the list to the category chosen in the menu', async () => {
    page();
    await waitFor(() => expect(titles()).toHaveLength(2));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtra per categoria' }), { target: { value: 'penal' } });
    await waitFor(() => expect(titles()).toEqual(['Il reato omissivo']));
    expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'penal' }));
  });
});

// L-73: «Suggerisci contenuto» opens in the page, at the top of Explore, not over it.
describe('BulletinBoardPage - «Suggerisci contenuto» in the page', () => {
  const open = async () => {
    page();
    const menu = await screen.findByRole('button', { name: 'Azioni su «Recente»' });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Suggerisci contenuto/ }));
    return menu;
  };

  it('opens as a region of the page that takes the focus, with no veil over the content', async () => {
    await open();
    const region = await screen.findByRole('region', { name: 'Suggerisci contenuto' });
    expect(region).toHaveTextContent('a «Recente» di @marta');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
    // Before the cards: at the top of Explore, in the flow.
    expect(region.compareDocumentPosition(screen.getAllByRole('article')[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(region).toHaveFocus());
  });

  it('closes on Esc, the focus back to what opened it', async () => {
    const menu = await open();
    const region = await screen.findByRole('region', { name: 'Suggerisci contenuto' });
    await waitFor(() => expect(region).toHaveFocus());
    fireEvent.keyDown(region, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Suggerisci contenuto' })).toBeNull());
    expect(menu).toHaveFocus();
  });

  // LC114, the consultant: a row's checkbox and its chevron had no name.
  it('names each row\'s checkbox and a dossier\'s chevron', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'Contratti', createdAt: '2026-11-01T10:00:00Z', items: [], tags: [] }] });
    await open();
    const region = await screen.findByRole('region', { name: 'Suggerisci contenuto' });
    const box = within(region).getByRole('checkbox', { name: 'Seleziona «Contratti»' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-checked', 'true');
    const chevron = within(region).getByRole('button', { name: 'Apri «Contratti»' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(chevron);
    expect(within(region).getByRole('button', { name: 'Chiudi «Contratti»' })).toHaveAttribute('aria-expanded', 'true');
    // 44 px to touch on a phone, 32 from md; the drawing inside stays small.
    for (const control of [box, within(region).getByRole('button', { name: 'Chiudi «Contratti»' })]) {
      expect(control).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-8', 'md:min-w-8');
    }
    // The viewer's tabs in Italian.
    expect(within(region).getByRole('button', { name: /^Dossier\b/ })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: /^Norme rapide/ })).toBeInTheDocument();
    appStore.setState({ dossiers: [] });
  });

  it('closes with «Chiudi» and with «Annulla»', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Chiudi' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Suggerisci contenuto' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni su «Recente»' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su «Recente»' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Suggerisci contenuto/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Suggerisci contenuto' })).toBeNull());
  });
});

// LC138 (L-73): the Forum's other windows open in the page too.
describe('BulletinBoardPage - «Segnala», «Aggiungi ai miei dossier» and «Pubblica un dossier» in the page', () => {
  it('opens «Segnala» at the top of the tab, sends the report, and Esc gives the focus back to the menu', async () => {
    page();
    const menu = await screen.findByRole('button', { name: 'Azioni su «Recente»' });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Segnala/ }));
    const region = await screen.findByRole('region', { name: 'Segnala il dossier pubblicato' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
    expect(region.compareDocumentPosition(screen.getAllByRole('article')[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(region).toHaveFocus());
    fireEvent.keyDown(region, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Segnala il dossier pubblicato' })).toBeNull());
    expect(menu).toHaveFocus();

    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Segnala/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Spam/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Segnala' }));
    await waitFor(() => expect(service.report).toHaveBeenCalledWith('a', 'spam', undefined));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Segnala il dossier pubblicato' })).toBeNull());
  });

  it('opens «Aggiungi ai miei dossier» above the cards, one space at a time', async () => {
    page();
    const add = await screen.findByRole('button', { name: 'Aggiungi «Recente» ai miei dossier' });
    add.focus();
    fireEvent.click(add);
    const region = await screen.findByRole('region', { name: 'Aggiungi ai miei dossier' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(region).toHaveFocus());
    // «Segnala» opened from a card closes the space already open.
    fireEvent.click(screen.getByRole('button', { name: 'Azioni su «Più votato»' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Segnala/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Aggiungi ai miei dossier' })).toBeNull());
    expect(screen.getByRole('region', { name: 'Segnala il dossier pubblicato' })).toBeInTheDocument();
  });

  it('opens «Pubblica un dossier» under the header; Esc gives the focus back to the command', async () => {
    appStore.setState({ dossiers: [] });
    page();
    const command = screen.getByRole('button', { name: 'Pubblica un dossier' });
    command.focus();
    fireEvent.click(command);
    const region = await screen.findByRole('region', { name: 'Pubblica un dossier' });
    expect(command).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(region).toHaveFocus());
    fireEvent.keyDown(region, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pubblica un dossier' })).toBeNull());
    expect(command).toHaveFocus();
  });
});

// LC138, the on-screen round: every space of the tabs, the header's «Pubblica un dossier» and the archive's «Recupera i
// dossier» included, opens alone («Versioni» apart, in the view).
describe('BulletinBoardPage - one space at a time', () => {
  const mine = { ...env('m', 'Mio'), isOwner: true };
  const archived = {
    id: 'e1', name: 'Privacy', createdAt: '', quickNorms: [], customAliases: [], annotations: [], highlights: [],
    dossiers: [{ id: 'd1', title: 'GDPR', createdAt: '', items: [] }],
  };

  it('«Recupera i dossier» closes «Modifica» and is closed by it, and by the tab', async () => {
    service.getMyShared.mockResolvedValue([mine] as never);
    appStore.setState({ environments: [archived] as never });
    page();
    fireEvent.click(screen.getByRole('tab', { name: /Miei/ }));
    const menu = await screen.findByRole('button', { name: 'Azioni su «Mio»' });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Modifica/ }));
    expect(await screen.findByRole('region', { name: 'Modifica il dossier pubblicato' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recupera i dossier di «Privacy»' }));
    expect(screen.getByRole('region', { name: 'Recupera i dossier' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Modifica il dossier pubblicato' })).toBeNull());
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Modifica/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Recupera i dossier' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Recupera i dossier di «Privacy»' }));
    fireEvent.click(screen.getByRole('tab', { name: /Esplora/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Miei/ }));
    await screen.findByRole('button', { name: 'Azioni su «Mio»' });
    expect(screen.queryByRole('region', { name: 'Recupera i dossier' })).toBeNull();
    service.getMyShared.mockResolvedValue([]);
    appStore.setState({ environments: [] });
  });

  it('«Pubblica un dossier» closes a card\'s space and a card\'s space closes it', async () => {
    appStore.setState({ dossiers: [] });
    page();
    const menu = await screen.findByRole('button', { name: 'Azioni su «Recente»' });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Segnala/ }));
    await screen.findByRole('region', { name: 'Segnala il dossier pubblicato' });
    const publish = screen.getByRole('button', { name: 'Pubblica un dossier' });
    fireEvent.click(publish);
    expect(screen.getByRole('region', { name: 'Pubblica un dossier' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Segnala il dossier pubblicato' })).toBeNull());
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Segnala/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pubblica un dossier' })).toBeNull());
    expect(publish).toHaveAttribute('aria-expanded', 'false');
  });
});
