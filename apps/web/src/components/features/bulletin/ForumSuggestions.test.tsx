import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnvironmentSuggestion, SuggestionItem } from '../../../types';
import { loadStudyPacks } from '../../../utils/studyPacks';
import { appStore } from '../../../store/useAppStore';

const service = vi.hoisted(() => ({
  list: vi.fn(async () => ({ data: [], pagination: { page: 1, limit: 12, total: 0, pages: 1 } })),
  getMyShared: vi.fn(async () => []),
  getReceivedSuggestions: vi.fn(async (): Promise<unknown[]> => []),
  getSentSuggestions: vi.fn(async (): Promise<unknown[]> => []),
  getPendingSuggestionsCount: vi.fn(async () => 0),
  takeSuggestionItem: vi.fn(async (): Promise<unknown> => ({})),
  declineSuggestionItem: vi.fn(async () => ({})),
  revokeSuggestionItem: vi.fn(async () => ({})),
  addSuggestionItems: vi.fn(async () => ({})),
}));
const aliases = vi.hoisted(() => ({ delete: vi.fn(async () => {}) }));
vi.mock('../../../services/sharedEnvironmentService', () => ({ sharedEnvironmentService: service }));
vi.mock('../../../services/customAliasService', () => ({ customAliasService: aliases }));
vi.mock('../../../services/notificationService', () => ({ notificationService: { markRead: vi.fn(async () => {}) } }));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));

import { BulletinBoardPage } from './BulletinBoardPage';

beforeAll(async () => {
  await loadStudyPacks();
});

const item = (id: string, itemType: SuggestionItem['itemType'], payload: unknown): SuggestionItem =>
  ({ id, itemType, payload, status: 'pending', createdAt: '' });

function suggestion(id: string, items: SuggestionItem[], extra: Partial<EnvironmentSuggestion> = {}): EnvironmentSuggestion {
  return {
    id, sharedEnvironmentId: 'env', items, isOwn: false, createdAt: '2026-11-01T10:00:00Z', updatedAt: '',
    sharedEnvironment: { id: 'env', title: 'Contratti', user: { id: 'u1', username: 'luca' } },
    suggester: { id: 'u2', username: 'marta' }, message: 'Guarda queste',
    counts: { pending: items.length, taken: 0, declined: 0 }, aggregateStatus: 'open', ...extra,
  };
}

const note = item('n1', 'annotation', { text: 'Una nota', articleId: 'art. 1' });
const alias = item('a1', 'alias', { trigger: 'gdpr', expandTo: 'Regolamento UE 2016/679', aliasType: 'shortcut' });
const received = suggestion('r1', [note, alias]);
const sent = suggestion('s1', [item('n2', 'annotation', { text: 'Mia nota', articleId: 'art. 2' })], { isOwn: true });

beforeEach(() => {
  vi.clearAllMocks();
  service.getReceivedSuggestions.mockResolvedValue([received]);
  service.getSentSuggestions.mockResolvedValue([sent]);
  service.takeSuggestionItem.mockResolvedValue({});
  appStore.setState({ dossiers: [], quickNorms: [], customAliases: [], annotations: [], highlights: [] });
});

const openTab = async () => {
  render(<MemoryRouter><BulletinBoardPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('tab', { name: /Suggeriment/ }));
  return screen.findByRole('button', { name: /da @marta/ });
};
const press = (button: HTMLElement) => { button.focus(); fireEvent.click(button); };
const noWindow = () => {
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('.fixed.inset-0')).toBeNull();
};
const REVIEW = 'Suggerimento da @marta';
const EDIT = 'Suggerimento a @luca';

describe('Forum suggestions in the page (LC140, L-73)', () => {
  it('opens a received suggestion as a region at the top of Suggerimenti; Esc gives the focus back to its row', async () => {
    const row = await openTab();
    press(row);
    const region = await screen.findByRole('region', { name: REVIEW });
    noWindow();
    expect(region.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(region).toHaveFocus());
    fireEvent.keyDown(region, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: REVIEW })).toBeNull());
    expect(row).toHaveFocus();
  });

  it('takes an item with the focus on the space, and «Chiudi» still gives the focus back to the row', async () => {
    const row = await openTab();
    press(row);
    const region = await screen.findByRole('region', { name: REVIEW });
    press(within(region).getByRole('button', { name: 'Prendi «Una nota»' }));
    await waitFor(() => expect(service.takeSuggestionItem).toHaveBeenCalledWith('r1', 'n1'));
    expect(region).toHaveFocus();
    await waitFor(() => expect(service.getReceivedSuggestions).toHaveBeenCalledTimes(2));
    fireEvent.click(within(region).getAllByRole('button', { name: 'Chiudi' })[0]);
    await waitFor(() => expect(screen.queryByRole('region', { name: REVIEW })).toBeNull());
    expect(screen.getByRole('button', { name: /da @marta/ })).toHaveFocus();
  });

  it('opens «Rifiuta»\'s note under the item, Esc back to «Rifiuta», and sends the note', async () => {
    press(await openTab());
    const region = await screen.findByRole('region', { name: REVIEW });
    const decline = within(region).getByRole('button', { name: 'Rifiuta «Una nota»' });
    press(decline);
    const field = within(region).getByRole('region', { name: 'Rifiuta «Una nota»' });
    noWindow();
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(within(region).queryByRole('region', { name: 'Rifiuta «Una nota»' })).toBeNull());
    expect(decline).toHaveFocus();
    // Esc closed the note alone, not the review.
    expect(screen.getByRole('region', { name: REVIEW })).toBeInTheDocument();
    press(decline);
    fireEvent.change(within(region).getByRole('textbox', { name: /Nota per chi ha suggerito/ }), { target: { value: 'No, grazie' } });
    fireEvent.click(within(region).getByRole('button', { name: 'Conferma rifiuto' }));
    await waitFor(() => expect(service.declineSuggestionItem).toHaveBeenCalledWith('r1', 'n1', 'No, grazie'));
  });

  it('opens the alias conflict as a choice under the item; Annulla and Esc give the focus back to «Prendi»', async () => {
    service.takeSuggestionItem.mockRejectedValue({
      response: { status: 409, data: { error: 'alias_trigger_conflict', suggestedTrigger: 'gdpr', existingAliasId: 'mine' } },
    });
    press(await openTab());
    const region = await screen.findByRole('region', { name: REVIEW });
    fireEvent.click(within(region).getByRole('button', { name: /Alias \(1\)/ }));
    const take = within(region).getByRole('button', { name: 'Prendi «gdpr»' });
    press(take);
    const choice = await within(region).findByRole('region', { name: 'Trigger già in uso' });
    noWindow();
    await waitFor(() => expect(choice).toHaveFocus());
    fireEvent.click(within(choice).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(within(region).queryByRole('region', { name: 'Trigger già in uso' })).toBeNull());
    expect(take).toHaveFocus();

    press(take);
    const again = await within(region).findByRole('region', { name: 'Trigger già in uso' });
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => expect(within(region).queryByRole('region', { name: 'Trigger già in uso' })).toBeNull());
    expect(take).toHaveFocus();
    expect(screen.getByRole('region', { name: REVIEW })).toBeInTheDocument();
  });

  it('renames through the choice: the same call with the new trigger, then the focus on the review', async () => {
    service.takeSuggestionItem.mockRejectedValueOnce({
      response: { status: 409, data: { error: 'alias_trigger_conflict', suggestedTrigger: 'gdpr', existingAliasId: 'mine' } },
    });
    press(await openTab());
    const region = await screen.findByRole('region', { name: REVIEW });
    fireEvent.click(within(region).getByRole('button', { name: /Alias \(1\)/ }));
    press(within(region).getByRole('button', { name: 'Prendi «gdpr»' }));
    const choice = await within(region).findByRole('region', { name: 'Trigger già in uso' });
    expect(within(choice).getByRole('textbox', { name: 'Rinomina prima di importare' })).toHaveValue('gdpr-2');
    fireEvent.click(within(choice).getByRole('button', { name: 'Usa' }));
    await waitFor(() => expect(service.takeSuggestionItem).toHaveBeenLastCalledWith('r1', 'a1', 'gdpr-2'));
    await waitFor(() => expect(within(region).queryByRole('region', { name: 'Trigger già in uso' })).toBeNull());
    expect(region).toHaveFocus();
    expect(aliases.delete).not.toHaveBeenCalled();
  });

  it('opens a sent suggestion in the page; «Aggiungi item» opens under its command, Esc closes it alone', async () => {
    await openTab();
    fireEvent.click(screen.getByRole('tab', { name: /Inviati/ }));
    const row = await screen.findByRole('button', { name: /a "Contratti" di @luca/ });
    press(row);
    const region = await screen.findByRole('region', { name: EDIT });
    noWindow();
    await waitFor(() => expect(region).toHaveFocus());
    const add = within(region).getByRole('button', { name: 'Aggiungi item' });
    press(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    const form = within(region).getByRole('region', { name: 'Aggiungi item al suggerimento' });
    noWindow();
    expect(add.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(form).toHaveFocus());
    fireEvent.keyDown(form, { key: 'Escape' });
    await waitFor(() => expect(within(region).queryByRole('region', { name: 'Aggiungi item al suggerimento' })).toBeNull());
    expect(add).toHaveFocus();
    fireEvent.keyDown(region, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: EDIT })).toBeNull());
    expect(row).toHaveFocus();
  });

  it('keeps «Revocare…?» a confirmation, the only dialog, and revokes the item', async () => {
    await openTab();
    fireEvent.click(screen.getByRole('tab', { name: /Inviati/ }));
    press(await screen.findByRole('button', { name: /a "Contratti" di @luca/ }));
    const region = await screen.findByRole('region', { name: EDIT });
    press(within(region).getByRole('button', { name: 'Revoca «Mia nota»' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Revocare questo item?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoca' }));
    await waitFor(() => expect(service.revokeSuggestionItem).toHaveBeenCalledWith('s1', 'n2'));
  });

  it('one space at a time: a suggestion closes the other, the switch and the tab close both', async () => {
    const row = await openTab();
    press(row);
    await screen.findByRole('region', { name: REVIEW });
    fireEvent.click(screen.getByRole('tab', { name: /Inviati/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: REVIEW })).toBeNull());
    press(await screen.findByRole('button', { name: /a "Contratti" di @luca/ }));
    await screen.findByRole('region', { name: EDIT });
    fireEvent.click(screen.getByRole('tab', { name: /Esplora/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Suggeriment/ }));
    await screen.findByRole('tab', { name: /Inviati/ });
    expect(screen.queryByRole('region', { name: EDIT })).toBeNull();
    // «Pubblica un dossier» closes the review, and opening the review closes it.
    fireEvent.click(screen.getByRole('tab', { name: /Ricevuti/ }));
    press(await screen.findByRole('button', { name: /da @marta/ }));
    await screen.findByRole('region', { name: REVIEW });
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica un dossier' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: REVIEW })).toBeNull());
    press(screen.getByRole('button', { name: /da @marta/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pubblica un dossier' })).toBeNull());
  });
});
