import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import apiClient from '../../../services/api';
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
// The publish form stands in as two buttons: one starts the publication and leaves it running, one has the server
// refuse it (the form keeps its error and says so through `onFailed`, as the real one does).
vi.mock('../dossier/PublishDossierDialog', () => ({
  PublishDossierForm: ({ setBusy, headingId, onFailed }: { setBusy: (b: boolean) => void; headingId: string; onFailed?: () => void }) => (
    <>
      <h2 id={headingId}>Pubblica nel Forum</h2>
      <button type="button" onClick={() => setBusy(true)}>Pubblica</button>
      <button type="button" onClick={() => { setBusy(false); onFailed?.(); }}>Il server rifiuta</button>
    </>
  ),
}));

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

/** What the real client (`services/api.ts`) rejects with when the server answers `status` with `data`: the request goes
 * through `apiClient` and its interceptors, only the network is replaced. */
async function clientError(status: number, data: unknown): Promise<unknown> {
  const adapter = async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, { status, statusText: '', headers: {}, config, data });
  };
  return apiClient.post('/shared-environments-suggestions/r1/items/a1/take', undefined, { adapter }).then(() => null, (err: unknown) => err);
}
const CONFLICT = { error: 'alias_trigger_conflict', existingAliasId: 'mine', suggestedTrigger: 'gdpr' };

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
    const conflict = await clientError(409, CONFLICT);
    // The client's own shape, not axios's: the 409 is read from it.
    expect(conflict).toMatchObject({ status: 409, data: CONFLICT });
    expect(conflict).not.toHaveProperty('response');
    service.takeSuggestionItem.mockRejectedValue(conflict);
    press(await openTab());
    const region = await screen.findByRole('region', { name: REVIEW });
    fireEvent.click(within(region).getByRole('button', { name: /Alias \(1\)/ }));
    const take = within(region).getByRole('button', { name: 'Prendi «gdpr»' });
    press(take);
    const choice = await within(region).findByRole('region', { name: 'Trigger già in uso' });
    noWindow();
    await waitFor(() => expect(choice).toHaveFocus());
    // While the choice is open, «Prendi» waits for it: said, and a press sends nothing (LC145).
    expect(take).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(take);
    expect(service.takeSuggestionItem).toHaveBeenCalledTimes(1);
    fireEvent.click(within(choice).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(within(region).queryByRole('region', { name: 'Trigger già in uso' })).toBeNull());
    expect(take).toHaveFocus();
    expect(take).not.toHaveAttribute('aria-disabled');

    press(take);
    const again = await within(region).findByRole('region', { name: 'Trigger già in uso' });
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => expect(within(region).queryByRole('region', { name: 'Trigger già in uso' })).toBeNull());
    expect(take).toHaveFocus();
    expect(screen.getByRole('region', { name: REVIEW })).toBeInTheDocument();
  });

  it('a «Prendi» refused for another reason says why under the item; the review stays, the focus back on «Prendi»', async () => {
    service.takeSuggestionItem.mockRejectedValue(await clientError(500, {}));
    press(await openTab());
    const region = await screen.findByRole('region', { name: REVIEW });
    const take = within(region).getByRole('button', { name: 'Prendi «Una nota»' });
    press(take);
    expect(await within(region).findByRole('alert')).toHaveTextContent('Richiesta non riuscita (errore 500). Riprova tra poco.');
    expect(screen.queryByText('Errore')).toBeNull();
    await waitFor(() => expect(take).toHaveFocus());
    expect(take).toBeEnabled();
    expect(screen.getByRole('region', { name: REVIEW })).toBeInTheDocument();
  });

  it('renames through the choice: the same call with the new trigger, then the focus on the review', async () => {
    service.takeSuggestionItem.mockRejectedValueOnce(await clientError(409, CONFLICT));
    // «gdpr-2» is the user's already: the first free number is proposed.
    appStore.setState({ customAliases: [{ id: 'mine', trigger: 'gdpr', type: 'shortcut', expandTo: 'x', createdAt: '' }, { id: 'm2', trigger: 'gdpr-2', type: 'shortcut', expandTo: 'y', createdAt: '' }] as never });
    press(await openTab());
    const region = await screen.findByRole('region', { name: REVIEW });
    fireEvent.click(within(region).getByRole('button', { name: /Alias \(1\)/ }));
    press(within(region).getByRole('button', { name: 'Prendi «gdpr»' }));
    const choice = await within(region).findByRole('region', { name: 'Trigger già in uso' });
    expect(within(choice).getByRole('textbox', { name: 'Rinomina prima di importare' })).toHaveValue('gdpr-3');
    fireEvent.click(within(choice).getByRole('button', { name: 'Usa' }));
    await waitFor(() => expect(service.takeSuggestionItem).toHaveBeenLastCalledWith('r1', 'a1', 'gdpr-3'));
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

  it('keeps «Revocare…?» a confirmation, the only dialog; the item revoked, the focus goes to the space', async () => {
    await openTab();
    fireEvent.click(screen.getByRole('tab', { name: /Inviati/ }));
    press(await screen.findByRole('button', { name: /a "Contratti" di @luca/ }));
    const region = await screen.findByRole('region', { name: EDIT });
    press(within(region).getByRole('button', { name: 'Revoca «Mia nota»' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Revocare questo item?' });
    // Read again, the item is gone, with the button the confirmation grew from.
    service.getSentSuggestions.mockResolvedValue([{ ...sent, items: [], counts: { pending: 0, taken: 0, declined: 0 }, aggregateStatus: 'revoked' }]);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoca' }));
    await waitFor(() => expect(service.revokeSuggestionItem).toHaveBeenCalledWith('s1', 'n2'));
    await waitFor(() => expect(within(region).queryByRole('button', { name: 'Revoca «Mia nota»' })).toBeNull());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(region).toHaveFocus());
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

  // #709's one-space rule: an old link's import and «Pubblica un dossier» never open together.
  it('«Pubblica un dossier» closes an old link\'s import', async () => {
    render(<MemoryRouter initialEntries={['/forum?import=non-un-link']}><BulletinBoardPage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Link non valido' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica un dossier' }));
    expect(await screen.findByRole('region', { name: 'Pubblica un dossier' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Link non valido' })).toBeNull());
  });

  // LC145, «no silent loss»: a space closed to make room for another keeps what was typed in it.
  it('keeps «Rifiuta»\'s note typed when a refused publication reopens its space over the review', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'Dossier mio', createdAt: '', items: [{ id: 'i', type: 'norma', addedAt: '', data: {} }], kind: 'studio' }] as never });
    press(await openTab());
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica un dossier' }));
    fireEvent.click(await screen.findByRole('button', { name: /Dossier mio/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    // While it publishes, a suggestion opens and a rejection note is typed.
    press(screen.getByRole('button', { name: /da @marta/ }));
    let region = await screen.findByRole('region', { name: REVIEW });
    press(within(region).getByRole('button', { name: 'Rifiuta «Una nota»' }));
    fireEvent.change(within(region).getByRole('textbox', { name: /Nota per chi ha suggerito/ }), { target: { value: 'Non ora' } });
    // The server refuses: the publish space opens again, and the review closes to make room.
    fireEvent.click(screen.getByRole('button', { name: 'Il server rifiuta' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: REVIEW })).toBeNull());
    expect(screen.getByRole('region', { name: 'Pubblica nel Forum' })).toBeInTheDocument();
    // Opened again, the note is there.
    press(screen.getByRole('button', { name: /da @marta/ }));
    region = await screen.findByRole('region', { name: REVIEW });
    press(within(region).getByRole('button', { name: 'Rifiuta «Una nota»' }));
    expect(within(region).getByRole('textbox', { name: /Nota per chi ha suggerito/ })).toHaveValue('Non ora');
    expect(service.declineSuggestionItem).not.toHaveBeenCalled();
  });
});
