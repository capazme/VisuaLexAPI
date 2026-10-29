import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../../services/corsiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/corsiService')>();
  return {
    ...actual,
    corsiService: { list: vi.fn(), declaration: vi.fn(), acceptDeclaration: vi.fn() },
  };
});
vi.mock('../../../../features/connections/connectionsService', () => ({
  connectionsService: { listConnectedApps: vi.fn() },
}));
vi.mock('../../../../store/assistantProposals', () => ({ loadAssistantFeatures: vi.fn(async () => {}) }));

import { corsiService } from '../../../../services/corsiService';
import { loadAssistantFeatures } from '../../../../store/assistantProposals';
import { connectionsService, type ConnectedApp } from '../../../../features/connections/connectionsService';
import { coursesSwitchStore } from './coursesSwitch';
import { CoursesView } from './CoursesView';
import { CREATE_SENTENCE } from './corsiLabels';
import { declaration, listed } from './__fixtures__/corsi';

const list = vi.mocked(corsiService.list);
const readDeclaration = vi.mocked(corsiService.declaration);
const accept = vi.mocked(corsiService.acceptDeclaration);
const apps = vi.mocked(connectionsService.listConnectedApps);

const app = (scopes: string[]): ConnectedApp => ({
  id: 'g1', clientName: 'Claude Code', redirectHost: 'localhost', scopes, canDelete: false, createdAt: '', lastUsedAt: null,
});

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/studia/percorsi']}>
      <Routes>
        <Route path="/studia/percorsi" element={<CoursesView />} />
        <Route path="/studia/percorsi/:id" element={<Where />} />
        <Route path="/studia/ripasso" element={<Where />} />
        <Route path="/collega-app" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  coursesSwitchStore.setState({ state: 'on' });
  list.mockResolvedValue([listed()]);
  readDeclaration.mockResolvedValue(declaration(true));
  apps.mockResolvedValue([app(['dossier:read', 'lingo:courses:read', 'lingo:courses:write'])]);
});

afterEach(() => {
  vi.clearAllMocks();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('«Percorsi», the list', () => {
  it('with the switch off draws nothing and goes back to «Oggi», reading no course', async () => {
    coursesSwitchStore.setState({ state: 'off' });
    renderView();
    expect(await screen.findByTestId('where')).toHaveTextContent('/studia/ripasso');
    expect(list).not.toHaveBeenCalled();
    expect(readDeclaration).not.toHaveBeenCalled();
  });

  it('waits for the features while the switch is unknown', () => {
    coursesSwitchStore.setState({ state: 'unknown' });
    renderView();
    expect(screen.getByRole('status')).toHaveTextContent('Caricamento…');
    expect(list).not.toHaveBeenCalled();
  });

  it('a switch the features read could not tell says so, with «Riprova», and goes on once it is on', async () => {
    coursesSwitchStore.setState({ state: 'unknown' });
    renderView();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Non è stato possibile sapere se i percorsi sono disponibili');
    vi.mocked(loadAssistantFeatures).mockImplementationOnce(async () => coursesSwitchStore.setState({ state: 'on' }));
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /Proprietà intellettuale/ })).toBeInTheDocument();
  });

  it('an «off» known from before waits for the features read: switched on meanwhile, the page is drawn', async () => {
    coursesSwitchStore.setState({ state: 'off' });
    vi.mocked(loadAssistantFeatures).mockImplementationOnce(async () => coursesSwitchStore.setState({ state: 'on' }));
    renderView();
    expect(await screen.findByRole('link', { name: /Proprietà intellettuale/ })).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('lists each course with its title, subject, competences, state and next step, the row opening the course', async () => {
    list.mockResolvedValue([
      listed(),
      listed({ id: 'corso-2', titolo: 'Brevetti', stato: 'in-preparazione', competenze: { acquisite: 0, totale: 1 }, prossimo: null, moduli: { contati: 0, previsti: 4 } }),
    ]);
    renderView();
    const first = await screen.findByRole('link', { name: /Proprietà intellettuale/ });
    expect(first).toHaveTextContent('Diritto civile');
    expect(first).toHaveTextContent('3 di 8 competenze');
    expect(first).toHaveTextContent('In corso');
    expect(first).toHaveTextContent('Prossimo: modulo 4, Il marchio di fatto');
    const second = screen.getByRole('link', { name: /Brevetti/ });
    expect(second).toHaveTextContent('0 di 1 competenza');
    expect(second).toHaveTextContent('In preparazione');
    expect(second).toHaveTextContent('Nessun modulo ancora');
    await userEvent.setup().click(first);
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/percorsi/corso-1');
  });

  it('with no course says what a course is, gives the sentence to copy and the way to connect an app', async () => {
    list.mockResolvedValue([]);
    renderView();
    const empty = await screen.findByRole('region', { name: 'Non hai ancora percorsi' });
    expect(within(empty).getByText(CREATE_SENTENCE)).toBeInTheDocument();
    expect(within(empty).getByText(/non si carica nessun file/)).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: 'Copia la frase per il tuo assistente' })).toBeInTheDocument();
    expect(await within(empty).findByText(/La tua app collegata può creare percorsi/)).toBeInTheDocument();
  });

  it('tells a connection made without the courses\' permission to connect again', async () => {
    list.mockResolvedValue([]);
    apps.mockResolvedValue([app(['dossier:read', 'lingo:cards:write'])]);
    renderView();
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('La tua app collegata non ha ancora il permesso di creare percorsi');
    expect(within(note).getByRole('link', { name: 'Collega un’app AI' })).toHaveAttribute('href', '/collega-app');
  });

  it('with no app connected, points to «Collega un\'app AI»', async () => {
    list.mockResolvedValue([]);
    apps.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText('Non hai ancora collegato un’app AI a VisuaLex.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Collega un’app AI' })).toBeInTheDocument();
  });

  it('says it is loading, then a failure in words with «Riprova», offline apart', async () => {
    list.mockRejectedValueOnce({ status: undefined, message: 'Network Error' });
    renderView();
    expect(screen.getByText('Caricamento dei percorsi…')).toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sei offline o il server non risponde');
    list.mockRejectedValueOnce({ status: 500, message: 'boom', data: { detail: 'Errore' } });
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Non è stato possibile leggere i tuoi percorsi.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('offline');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: /Proprietà intellettuale/ })).toBeInTheDocument();
  });

  it('reads again when the user comes back to the page: the assistant may have added a course', async () => {
    renderView();
    await screen.findByRole('link', { name: /Proprietà intellettuale/ });
    list.mockResolvedValue([listed(), listed({ id: 'corso-2', titolo: 'Diritto d’autore' })]);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByRole('link', { name: /Diritto d’autore/ })).toBeInTheDocument();
    // The list stayed on screen while the second read travelled.
    expect(screen.getByRole('link', { name: /Proprietà intellettuale/ })).toBeInTheDocument();
  });

  it('a 404 on the list is the switch turned off: back to «Oggi»', async () => {
    list.mockRejectedValue({ status: 404, message: 'Not found', data: { detail: 'Not found' } });
    renderView();
    expect(await screen.findByTestId('where')).toHaveTextContent('/studia/ripasso');
    expect(coursesSwitchStore.getState().state).toBe('off');
  });
});

describe('«Percorsi», the declaration (§12)', () => {
  it('before the first course opens by itself, every word the server\'s; accepting it closes it', async () => {
    list.mockResolvedValue([]);
    readDeclaration.mockResolvedValue(declaration(false));
    accept.mockResolvedValue({ accettata: declaration(true) });
    renderView();
    const dialog = await screen.findByRole('dialog', { name: 'Il tuo materiale di studio' });
    const button = within(dialog).getByRole('button', { name: 'Accetto' });
    expect(button).toBeDisabled();
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('checkbox', { name: /Dichiaro di avere il diritto/ }));
    await user.click(button);
    expect(accept).toHaveBeenCalledWith('testo-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Leggi e accetta' })).toBeNull();
  });

  it('says nothing of a «changed» declaration while the list is still being read', async () => {
    list.mockReturnValue(new Promise(() => {}));
    readDeclaration.mockResolvedValue(declaration(false));
    renderView();
    await waitFor(() => expect(readDeclaration).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(/è cambiata/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leggi e accetta' })).toBeNull();
  });

  it('closed with «Annulla», it waits behind «Leggi e accetta»', async () => {
    list.mockResolvedValue([]);
    readDeclaration.mockResolvedValue(declaration(false));
    renderView();
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Leggi e accetta' }));
    expect(await screen.findByRole('dialog', { name: 'Il tuo materiale di studio' })).toBeInTheDocument();
  });

  it('a newer version answered by the acceptance is shown unticked, to be read again', async () => {
    list.mockResolvedValue([]);
    readDeclaration.mockResolvedValue(declaration(false));
    accept.mockResolvedValueOnce({ richiedeTesto: { ...declaration(false), id: 'testo-2', versione: 2, corpo: 'Le parole nuove.' } });
    renderView();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Accetto' }));
    expect(await within(dialog).findByText('Le parole nuove.')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
    expect(within(dialog).getByText('Il testo è cambiato nel frattempo: rileggilo e conferma.')).toBeInTheDocument();
  });

  it('with courses already there and a new version to accept, it does not open by itself', async () => {
    readDeclaration.mockResolvedValue(declaration(false, { versione: 2 }));
    renderView();
    expect(await screen.findByRole('button', { name: 'Leggi e accetta' })).toBeInTheDocument();
    expect(screen.getByText(/La dichiarazione sul materiale di studio è cambiata/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
