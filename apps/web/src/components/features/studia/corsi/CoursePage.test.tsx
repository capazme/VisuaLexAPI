import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../../services/corsiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/corsiService')>();
  return {
    ...actual,
    corsiService: {
      get: vi.fn(), rename: vi.fn(), endProgrammeAt: vi.fn(), trash: vi.fn(), trashModule: vi.fn(), withdrawModule: vi.fn(), export: vi.fn(),
    },
  };
});
vi.mock('../../../../services/trashService', () => ({ trashService: { restore: vi.fn() } }));
vi.mock('../../../../store/assistantProposals', () => ({ loadAssistantFeatures: vi.fn(async () => {}) }));
vi.mock('../../../../utils/saveBlob', () => ({ saveBlob: vi.fn() }));

import { corsiService } from '../../../../services/corsiService';
import { trashService } from '../../../../services/trashService';
import { loadAssistantFeatures } from '../../../../store/assistantProposals';
import { saveBlob } from '../../../../utils/saveBlob';
import { notificationStore, resetNotifications, undoNotification } from '../../../ui/notifications/notifications';
import { coursesSwitchStore } from './coursesSwitch';
import { CoursePage } from './CoursePage';
import { examOf, missingOf, moduleOf, page } from './__fixtures__/corsi';
import type { EsamePagina, Mancanze } from '../../../../types/corsi';

/** An attempt as the course page carries it: by default failed at 55%, handed in on 20 November. */
const attempt = (over: Partial<NonNullable<EsamePagina['tentativo']>> = {}): NonNullable<EsamePagina['tentativo']> => ({
  id: 't-1',
  consegnatoIl: '2026-11-20T10:00:00.000Z',
  giorno: '2026-11-20',
  percentuale: 55,
  superato: false,
  perCompetenza: { C1: 70, C2: 40 },
  ...over,
});

const get = vi.mocked(corsiService.get);

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderPage(id = 'corso-1') {
  return render(
    <MemoryRouter initialEntries={[`/studia/percorsi/${id}`]}>
      <Routes>
        <Route path="/studia/percorsi/:id" element={<CoursePage />} />
        <Route path="/studia/percorsi" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const lastMessage = () => notificationStore.getState().entries.at(-1)?.message;

beforeEach(() => {
  coursesSwitchStore.setState({ state: 'on' });
  get.mockResolvedValue(page());
});

afterEach(() => {
  vi.clearAllMocks();
  resetNotifications();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('the course page', () => {
  it('shows the title, the subject, the state and each competence with its numbers, not only its state (§4)', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Proprietà intellettuale: i segni distintivi' })).toBeInTheDocument();
    expect(screen.getByText('Diritto civile')).toBeInTheDocument();
    const competences = screen.getByRole('region', { name: 'Competenze' });
    const [c1, c2] = within(competences).getAllByRole('listitem');
    expect(c1).toHaveTextContent('C1');
    expect(c1).toHaveTextContent('In corso');
    expect(c1).toHaveTextContent('1 di 2 sessioni · la prossima vale dal 3/11 · ultima 85%');
    expect(c2).toHaveTextContent('Da iniziare');
    expect(c2).toHaveTextContent('Ancora nessuna sessione valida');
    expect(get).toHaveBeenCalledWith('corso-1');
  });

  it('lists the modules in order with their state, competences and «creato da»; only one never opened can be deleted', async () => {
    renderPage();
    const modules = await screen.findByRole('region', { name: 'Moduli' });
    const rows = within(modules).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByRole('heading', { level: 4 }).textContent)).toEqual([
      'Modulo 1Titolo del modulo 1', 'Modulo 2Titolo del modulo 2', 'Modulo 3Titolo del modulo 3',
    ]);
    expect(rows[0]).toHaveTextContent('Fatto');
    expect(rows[1]).toHaveTextContent('In corso');
    expect(rows[1]).toHaveTextContent('Competenze C1, C2');
    expect(rows[2]).toHaveTextContent('creato da Claude Code');
    expect(within(rows[0]).queryByRole('button')).toBeNull();
    expect(within(rows[1]).queryByRole('button')).toBeNull();
    expect(within(rows[2]).getByRole('button', { name: 'Elimina il modulo 3, Titolo del modulo 3' })).toBeInTheDocument();
  });

  it('opens each module\'s session from its row: «Rileggi» done, «Riprendi» in progress, «Apri» not yet started (§6.4, §6.5)', async () => {
    renderPage();
    const modules = await screen.findByRole('region', { name: 'Moduli' });
    const rows = within(modules).getAllByRole('listitem');
    expect(within(rows[0]).getByRole('link', { name: 'Rileggi il modulo 1, Titolo del modulo 1' })).toHaveAttribute('href', '/studia/percorsi/corso-1/moduli/m-1');
    expect(within(rows[1]).getByRole('link', { name: 'Riprendi il modulo 2, Titolo del modulo 2' })).toHaveAttribute('href', '/studia/percorsi/corso-1/moduli/m-2');
    expect(within(rows[2]).getByRole('link', { name: 'Apri il modulo 3, Titolo del modulo 3' })).toHaveAttribute('href', '/studia/percorsi/corso-1/moduli/m-3');
  });

  it('deletes a module never opened to the trash, with «Annulla» restoring it', async () => {
    vi.mocked(corsiService.trashModule).mockResolvedValue({ trashId: 'trash-m3' });
    vi.mocked(trashService.restore).mockResolvedValue({ dossierId: null });
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: /Elimina il modulo 3/ }));
    await waitFor(() => expect(corsiService.trashModule).toHaveBeenCalledWith('corso-1', 'm-3'));
    await waitFor(() => expect(lastMessage()).toBe('Modulo «Titolo del modulo 3» spostato nel cestino.'));
    await undoNotification(notificationStore.getState().entries.at(-1)!.id);
    expect(trashService.restore).toHaveBeenCalledWith('trash-m3');
  });

  it('«in preparazione» says what is missing and gives the sentence for the assistant', async () => {
    get.mockResolvedValue(page({
      stato: 'in-preparazione',
      inPreparazione: missingOf({ moduli: { contati: 9, previsti: 10 }, manca: { esame: true }, schede: [{ codice: 'C4', schede: 3, servono: 5 }] }),
      esame: examOf({ stato: 'assente', esameId: null }),
    }));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'In preparazione' });
    expect(within(panel).getByText('9 di 10 moduli')).toBeInTheDocument();
    expect(within(panel).getByText('manca l’esame finale')).toBeInTheDocument();
    expect(within(panel).getByText('C4 ha 3 schede su 5')).toBeInTheDocument();
    expect(within(panel).getByText('Completa il percorso «Proprietà intellettuale: i segni distintivi» in VisuaLex: 9 di 10 moduli, manca l’esame finale, C4 ha 3 schede su 5.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Esame finale' })).toHaveTextContent('Il tuo assistente non ha ancora scritto l’esame.');
  });

  /** A course of three planned modules with three listed; module 3, never opened, deleted: two count. */
  const trimmed = (over: Partial<Mancanze> = {}) => page({
    stato: 'in-preparazione',
    moduli: [moduleOf(1), moduleOf(2, { stato: 'in-corso' })],
    inPreparazione: missingOf({ moduli: { contati: 2, previsti: 3 }, ...over }),
  });

  it('offers no «Il programma finisce qui» while no module was deleted, however short the programme (Q11)', async () => {
    get.mockResolvedValue(trimmed());
    renderPage();
    await screen.findByRole('region', { name: 'In preparazione' });
    expect(screen.queryByRole('button', { name: 'Il programma finisce qui' })).toBeNull();
  });

  it('beside a module\'s deletion, «Il programma finisce qui» lowers the planned modules to those that count, confirmed (Q11)', async () => {
    vi.mocked(corsiService.trashModule).mockResolvedValue({ trashId: 'trash-m3' });
    vi.mocked(corsiService.endProgrammeAt).mockResolvedValue({ id: 'corso-1', titolo: 'x', moduliPrevisti: 2 });
    renderPage();
    const user = userEvent.setup();
    get.mockResolvedValue(trimmed());
    await user.click(await screen.findByRole('button', { name: /Elimina il modulo 3/ }));
    const modules = screen.getByRole('region', { name: 'Moduli' });
    const offer = await within(modules).findByText(/Hai eliminato il modulo 3, «Titolo del modulo 3»/);
    // An exam written and every competence with its cards: closing the programme is what opens the exam.
    expect(offer).toHaveTextContent('il programma può finire con i 2 moduli che ci sono, così l’esame potrà aprirsi.');
    await user.click(within(modules).getByRole('button', { name: 'Il programma finisce qui' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Il programma finisce con 2 moduli?' });
    expect(confirm).toHaveTextContent('L’esame finale potrà aprirsi con i moduli che ci sono.');
    expect(corsiService.endProgrammeAt).not.toHaveBeenCalled();
    get.mockResolvedValue(page());
    await user.click(within(confirm).getByRole('button', { name: 'Il programma finisce qui' }));
    expect(corsiService.endProgrammeAt).toHaveBeenCalledWith('corso-1', 2);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'In preparazione' })).toBeNull());
    expect(screen.queryByText(/Hai eliminato il modulo 3/)).toBeNull();
  });

  it.each([
    ['the exam is missing', { manca: { esame: true } }],
    ['a competence lacks cards', { schede: [{ codice: 'C2', schede: 3, servono: 5 }] }],
    ['a competence has no module', { competenzeSenzaModulo: ['C2'] }],
  ])('promises no exam when %s: closing the programme does not open it', async (_, over) => {
    vi.mocked(corsiService.trashModule).mockResolvedValue({ trashId: 'trash-m3' });
    renderPage();
    const user = userEvent.setup();
    get.mockResolvedValue(trimmed(over));
    await user.click(await screen.findByRole('button', { name: /Elimina il modulo 3/ }));
    const offer = await screen.findByText(/Hai eliminato il modulo 3/);
    expect(offer).toHaveTextContent('il programma può finire con i 2 moduli che ci sono.');
    expect(offer).not.toHaveTextContent('esame');
    await user.click(screen.getByRole('button', { name: 'Il programma finisce qui' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).not.toHaveTextContent('esame');
    expect(confirm).toHaveTextContent('Il tuo assistente non potrà aggiungere altri moduli');
  });

  it('«Annulla» on the deletion takes the offer back', async () => {
    vi.mocked(corsiService.trashModule).mockResolvedValue({ trashId: 'trash-m3' });
    vi.mocked(trashService.restore).mockResolvedValue({ dossierId: null });
    renderPage();
    get.mockResolvedValue(trimmed());
    await userEvent.setup().click(await screen.findByRole('button', { name: /Elimina il modulo 3/ }));
    await screen.findByText(/Hai eliminato il modulo 3/);
    get.mockResolvedValue(page());
    await undoNotification(notificationStore.getState().entries.at(-1)!.id);
    await waitFor(() => expect(screen.queryByText(/Hai eliminato il modulo 3/)).toBeNull());
  });

  it('offers «Ritira questo modulo» on an opened module superseded by a correction, once confirmed', async () => {
    get.mockResolvedValue(page({
      moduli: [moduleOf(1, { sostituitoDa: ['m-1b'], ritirabile: true }), moduleOf(1, { id: 'm-1b', stato: 'da-iniziare', sostituisceId: 'm-1', titolo: 'Corretto' })],
    }));
    vi.mocked(corsiService.withdrawModule).mockResolvedValue();
    renderPage();
    const modules = await screen.findByRole('region', { name: 'Moduli' });
    expect(within(modules).getByText('correzione del modulo 1')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(modules).getByRole('button', { name: 'Ritira questo modulo' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ritira il modulo' }));
    expect(corsiService.withdrawModule).toHaveBeenCalledWith('corso-1', 'm-1');
  });

  it('shows a withdrawn module as such, with no action', async () => {
    get.mockResolvedValue(page({ moduli: [moduleOf(1, { stato: 'ritirato', sostituitoDa: ['m-1b'] })] }));
    renderPage();
    const modules = await screen.findByRole('region', { name: 'Moduli' });
    expect(within(modules).getByText('Ritirato')).toBeInTheDocument();
    expect(within(modules).queryByRole('button')).toBeNull();
  });

  it.each([
    [examOf({ stato: 'assente', esameId: null }), 'Nessun esame.'],
    [examOf({ stato: 'bloccato' }), 'Si apre quando hai fatto tutti i moduli.'],
    [examOf({ stato: 'aperto' }), 'Aperto: hai fatto tutti i moduli.'],
    [examOf({ stato: 'in-corso', tentativo: attempt({ consegnatoIl: null, giorno: null, percentuale: null, superato: null }) }), 'Iniziato, non ancora consegnato.'],
    [examOf({ stato: 'superato', tentativo: attempt({ percentuale: 82, giorno: '2026-11-20', superato: true }) }), 'Superato il 20 novembre 2026, con l’82%.'],
    [examOf({ stato: 'non-superato', tentativo: attempt(), nuovoEsameDal: '2026-11-23', competenzeSotto: ['C2'] }), 'Un nuovo esame si può chiedere dal 23 novembre 2026.'],
    [examOf({ stato: 'non-superato', tentativo: attempt(), nuovoEsameDal: '2026-11-11', competenzeSotto: ['C2'] }), /Non superato \(55%\)\. Sotto il 60%: C2; il ripasso te la propone\..*Un nuovo esame si può chiedere dall’11 novembre 2026\./],
  ])('draws the final exam %#', async (esame, words: string | RegExp) => {
    get.mockResolvedValue(page({ esame }));
    renderPage();
    expect(await screen.findByRole('region', { name: 'Esame finale' })).toHaveTextContent(words);
  });

  it('a failed exam, from the third day, says «Chiedi al tuo assistente un nuovo esame» with the competences under 60%', async () => {
    get.mockResolvedValue(page({ esame: examOf({ stato: 'non-superato', tentativo: attempt(), nuovoEsameDal: '2026-11-23', chiediNuovoEsame: true, competenzeSotto: ['C2'] }) }));
    renderPage();
    const exam = await screen.findByRole('region', { name: 'Esame finale' });
    expect(exam).toHaveTextContent('Sotto il 60%: C2');
    expect(exam).toHaveTextContent('Chiedi al tuo assistente un nuovo esame');
    expect(within(exam).getByText(/Scrivi un nuovo esame finale per il percorso .* insisti su C2\./)).toBeInTheDocument();
  });

  it('links the course\'s dossier, and says when it is gone', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Dossier «Segni distintivi»' })).toHaveAttribute('href', '/dossier?dossier=dossier-1');
  });

  it('says when the dossier is gone', async () => {
    get.mockResolvedValue(page({ dossier: null }));
    renderPage();
    expect(await screen.findByText('Il dossier del percorso non c’è più.')).toBeInTheDocument();
  });

  it('renames from the menu', async () => {
    vi.mocked(corsiService.rename).mockResolvedValue({ id: 'corso-1', titolo: 'Nuovo nome', moduliPrevisti: 3 });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Azioni del percorso' }));
    await user.click(screen.getByRole('menuitem', { name: /Rinomina/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Rinomina il percorso' });
    const field = within(dialog).getByLabelText('Nome');
    await user.clear(field);
    expect(within(dialog).getByRole('button', { name: 'Salva' })).toBeDisabled();
    await user.type(field, 'Nuovo nome');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));
    expect(corsiService.rename).toHaveBeenCalledWith('corso-1', 'Nuovo nome');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('deletes to the trash from the menu: back to the list, the toast saying the dossier stays, «Annulla» restoring', async () => {
    vi.mocked(corsiService.trash).mockResolvedValue({ trashId: 'trash-1', dossier: { id: 'dossier-1', name: 'Segni distintivi' } });
    vi.mocked(trashService.restore).mockResolvedValue({ dossierId: null });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Azioni del percorso' }));
    await user.click(screen.getByRole('menuitem', { name: /Elimina/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/studia/percorsi');
    expect(lastMessage()).toBe('Percorso «Proprietà intellettuale: i segni distintivi» spostato nel cestino. Il dossier «Segni distintivi» resta in Dossier.');
    await undoNotification(notificationStore.getState().entries.at(-1)!.id);
    expect(trashService.restore).toHaveBeenCalledWith('trash-1');
  });

  it('a refused deletion says why and stays on the course', async () => {
    vi.mocked(corsiService.trash).mockRejectedValue({ status: 409, data: { detail: 'Non ora.' } });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Azioni del percorso' }));
    await user.click(screen.getByRole('menuitem', { name: /Elimina/ }));
    await waitFor(() => expect(lastMessage()).toBe('Non ora.'));
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('exports one course as a JSON file', async () => {
    vi.mocked(corsiService.export).mockResolvedValue({ schemaVersion: 1, corso: {} });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Azioni del percorso' }));
    await user.click(screen.getByRole('menuitem', { name: /Esporta/ }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'percorso-propriet-intellettuale-i-segni-distintivi.json'));
  });

  it('a course that is not the caller\'s, or gone, says so and checks the switch again', async () => {
    get.mockRejectedValue({ status: 404, data: { detail: 'Percorso non trovato.' } });
    renderPage('altro');
    expect(await screen.findByText('Questo percorso non c’è: forse è stato eliminato.')).toBeInTheDocument();
    expect(loadAssistantFeatures).toHaveBeenCalled();
  });

  it('a course trashed elsewhere, read again, is no longer kept on screen', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Competenze' });
    get.mockRejectedValue({ status: 404, data: { detail: 'Percorso non trovato.' } });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByText('Questo percorso non c’è: forse è stato eliminato.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Competenze' })).toBeNull();
  });

  it('writes «l’85%» and «l’8 novembre»', async () => {
    get.mockResolvedValue(page({ superatoIl: '2026-11-08', esame: examOf({ stato: 'superato', tentativo: attempt({ percentuale: 85, giorno: '2026-11-08', superato: true }) }) }));
    renderPage();
    expect(await screen.findByRole('region', { name: 'Esame finale' })).toHaveTextContent('Superato l’8 novembre 2026, con l’85%.');
    expect(screen.getByText('Percorso superato l’8 novembre 2026')).toBeInTheDocument();
  });

  it('offers to end the programme with one module in the singular', async () => {
    vi.mocked(corsiService.trashModule).mockResolvedValue({ trashId: 'trash-m3' });
    renderPage();
    get.mockResolvedValue(page({ stato: 'in-preparazione', moduli: [moduleOf(1)], inPreparazione: missingOf({ moduli: { contati: 1, previsti: 3 } }) }));
    await userEvent.setup().click(await screen.findByRole('button', { name: /Elimina il modulo 3/ }));
    expect(await screen.findByText(/Hai eliminato il modulo 3/)).toHaveTextContent('con l’unico modulo che c’è');
  });

  it('after a module goes to the trash the focus is on the modules\' heading', async () => {
    vi.mocked(corsiService.trashModule).mockResolvedValue({ trashId: 'trash-m3' });
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: /Elimina il modulo 3/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Moduli' })).toHaveFocus());
  });

  it('a failed read says so, offline apart, with «Riprova»', async () => {
    get.mockRejectedValueOnce({ status: undefined });
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sei offline o il server non risponde');
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('region', { name: 'Competenze' })).toBeInTheDocument();
  });

  it('says the honest limit of what the course measures (§4)', async () => {
    renderPage();
    expect(await screen.findByText(/misura ciò che hai dimostrato sulle sue domande, a distanza di tempo/)).toBeInTheDocument();
  });
});
