import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { propose: vi.fn(), withdraw: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import type { Scheda, StatoScheda, TestoDaAccettare } from '../../../types/studia';
import { CardDetail } from './CardDetail';

const propose = vi.mocked(studiaService.propose);
const withdraw = vi.mocked(studiaService.withdraw);

const URN = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';

const card = (stato: StatoScheda, extra: Partial<Scheda> = {}): Scheda => ({
  id: 'c1', materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: 'Quando si risolve?', risposta: 'Con la diffida.', spiegazione: null, stato,
  createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null,
  ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: URN, isPrimary: true }],
  ...extra,
});

const text = (id: string, extra: Partial<TestoDaAccettare> = {}): TestoDaAccettare => ({
  id, chiave: 'PROPOSTA_SCHEDA', versione: 1, titolo: 'Titolo inventato', corpo: 'Uno.\n\nDue.',
  conferma: 'Conferma inventata', azione: 'Azione inventata',
  ...extra,
});

function renderDetail(c: Scheda) {
  const onChanged = vi.fn();
  render(<CardDetail card={c} onEdit={vi.fn()} onDelete={vi.fn()} onOpenAnchor={vi.fn()} onChanged={onChanged} />);
  return { onChanged };
}

beforeEach(() => {
  propose.mockReset();
  withdraw.mockReset();
});

describe('CardDetail, the actions each state allows', () => {
  it('offers a draft Modifica, Proponi alla comunità and Elimina, and not Ritira', () => {
    renderDetail(card('BOZZA_PERSONALE'));
    expect(screen.getByRole('button', { name: 'Modifica' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proponi alla comunità' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elimina' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ritira' })).not.toBeInTheDocument();
  });

  it('offers a proposed card only Ritira: it belongs to the community now', () => {
    renderDetail(card('PROPOSTA_COMMUNITY'));
    expect(screen.getByRole('button', { name: 'Ritira' })).toBeInTheDocument();
    for (const name of ['Modifica', 'Proponi alla comunità', 'Elimina']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it.each<StatoScheda>(['VALIDATA', 'DA_RIVEDERE'])('offers a %s card no action on the card itself', (stato) => {
    renderDetail(card(stato));
    for (const name of ['Modifica', 'Proponi alla comunità', 'Ritira', 'Elimina']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});

describe('CardDetail, proposing', () => {
  it('sends one request however many times «Proponi alla comunità» is clicked at once', async () => {
    let finish: (value: Scheda) => void = () => {};
    propose.mockReturnValue(new Promise<Scheda>((resolve) => { finish = resolve; }));
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    const button = screen.getByRole('button', { name: 'Proponi alla comunità' });
    fireEvent.click(button);
    fireEvent.click(button);
    finish(card('PROPOSTA_COMMUNITY'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Scheda proposta alla comunità', 'success'));
    expect(propose).toHaveBeenCalledTimes(1);
  });

  it('opens the notice the server asks for, drawn from that version alone', async () => {
    const user = userEvent.setup();
    propose.mockResolvedValue({ richiedeTesto: text('t1') });
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));

    const dialog = await screen.findByRole('dialog', { name: 'Titolo inventato' });
    expect(propose).toHaveBeenCalledWith('c1');
    expect(within(dialog).getByText('Uno.')).toBeInTheDocument();
    expect(within(dialog).getByText('Due.')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Conferma inventata' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Azione inventata' })).toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('proposes with the accepted version and says so', async () => {
    const user = userEvent.setup();
    propose.mockResolvedValueOnce({ richiedeTesto: text('t1') });
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));
    await screen.findByRole('dialog');

    propose.mockResolvedValueOnce(card('PROPOSTA_COMMUNITY'));
    await user.click(screen.getByRole('checkbox', { name: 'Conferma inventata' }));
    await user.click(screen.getByRole('button', { name: 'Azione inventata' }));

    await waitFor(() => expect(propose).toHaveBeenLastCalledWith('c1', 't1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Scheda proposta alla comunità', 'success'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the points the proposal earned, and records them as seen (G1c)', async () => {
    const user = userEvent.setup();
    const livello = { livello: 1, totale: 25, nelLivello: 25, perIlProssimo: 100, oggi: 25 };
    propose.mockResolvedValue({ ...card('PROPOSTA_COMMUNITY'), xp: { crediti: [{ missione: 'scrivi', punti: 25 }], livello, nuovoLivello: false } });
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Scheda proposta alla comunità · hai guadagnato 25 punti', 'success'));
    expect(JSON.parse(localStorage.getItem('visualex.studia.visto')!)).toMatchObject({ xp: 25, livello: 1 });
    localStorage.removeItem('visualex.studia.visto');
  });

  it('says no points for a card proposed again, which earns none in its life', async () => {
    const user = userEvent.setup();
    const livello = { livello: 1, totale: 25, nelLivello: 25, perIlProssimo: 100, oggi: 25 };
    propose.mockResolvedValue({ ...card('PROPOSTA_COMMUNITY'), xp: { crediti: [], livello, nuovoLivello: false } });
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Scheda proposta alla comunità', 'success'));
    localStorage.removeItem('visualex.studia.visto');
  });

  it('proposes at once when the current notice is already accepted', async () => {
    const user = userEvent.setup();
    propose.mockResolvedValue(card('PROPOSTA_COMMUNITY'));
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Scheda proposta alla comunità', 'success'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the new version when one was saved meanwhile, with the box unticked', async () => {
    const user = userEvent.setup();
    propose.mockResolvedValueOnce({ richiedeTesto: text('t1') });
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));
    await screen.findByRole('dialog', { name: 'Titolo inventato' });

    propose.mockResolvedValueOnce({ richiedeTesto: text('t2', { versione: 2, titolo: 'Seconda inventata', conferma: 'Conferma nuova', azione: 'Azione nuova' }) });
    await user.click(screen.getByRole('checkbox', { name: 'Conferma inventata' }));
    await user.click(screen.getByRole('button', { name: 'Azione inventata' }));

    const dialog = await screen.findByRole('dialog', { name: 'Seconda inventata' });
    expect(within(dialog).getByRole('checkbox', { name: 'Conferma nuova' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Azione nuova' })).toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('leaves the card a draft on «Annulla»', async () => {
    const user = userEvent.setup();
    propose.mockResolvedValue({ richiedeTesto: text('t1') });
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(propose).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'La scheda non c’è più. Ho aggiornato l’elenco.'],
    [409, 'Questa scheda non è più una bozza. Ho aggiornato l’elenco.'],
    [500, 'Non sono riuscito a proporre la scheda. Riprova.'],
  ])('says so when the server answers %s', async (status, message) => {
    const user = userEvent.setup();
    propose.mockRejectedValue({ status, data: {} });
    const { onChanged } = renderDetail(card('BOZZA_PERSONALE'));
    await user.click(screen.getByRole('button', { name: 'Proponi alla comunità' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(message, 'error'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('CardDetail, withdrawing', () => {
  it('asks first, in the words of the spec, and does nothing on «Annulla»', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderDetail(card('PROPOSTA_COMMUNITY'));
    await user.click(screen.getByRole('button', { name: 'Ritira' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('La scheda torna una tua bozza; i voti ricevuti si perdono.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(withdraw).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('withdraws on confirmation and says the card is a draft again', async () => {
    const user = userEvent.setup();
    withdraw.mockResolvedValue(card('BOZZA_PERSONALE'));
    const { onChanged } = renderDetail(card('PROPOSTA_COMMUNITY'));
    await user.click(screen.getByRole('button', { name: 'Ritira' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ritira' }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Proposta ritirata: la scheda è di nuovo una bozza', 'success'));
    // The dialog leaves with its exit animation.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('sends one request however many times the confirmation is clicked while it is in flight', async () => {
    const user = userEvent.setup();
    let finish: (value: Scheda) => void = () => {};
    withdraw.mockReturnValue(new Promise<Scheda>((resolve) => { finish = resolve; }));
    const { onChanged } = renderDetail(card('PROPOSTA_COMMUNITY'));
    await user.click(screen.getByRole('button', { name: 'Ritira' }));
    const confirm = within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ritira' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    finish(card('BOZZA_PERSONALE'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith('Proposta ritirata: la scheda è di nuovo una bozza', 'success');
  });

  it('says when the card cannot be withdrawn any more', async () => {
    const user = userEvent.setup();
    withdraw.mockRejectedValue({ status: 409, data: {} });
    const { onChanged } = renderDetail(card('PROPOSTA_COMMUNITY'));
    await user.click(screen.getByRole('button', { name: 'Ritira' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ritira' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Questa scheda non si può più ritirare. Ho aggiornato l’elenco.', 'error'));
  });
});

describe('CardDetail, what the validators said', () => {
  const rilievi = [
    { giudizio: 'MIGLIORABILE' as const, motivazione: 'La risposta omette la diffida.', createdAt: '2026-10-06T09:00:00Z' },
    { giudizio: 'ERRATA' as const, motivazione: '<img src=x onerror=alert(1)>', createdAt: '2026-10-07T09:00:00Z' },
  ];

  it('lists each reason under «Rilievi dei validatori», with its judgment and date, as plain text', () => {
    renderDetail(card('PROPOSTA_COMMUNITY', { approvazioni: 1, rilievi }));
    const section = screen.getByRole('region', { name: 'Rilievi dei validatori' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Migliorabile');
    expect(items[0]).toHaveTextContent('06/10/2026');
    expect(items[0]).toHaveTextContent('La risposta omette la diffida.');
    expect(items[1]).toHaveTextContent('Errata');
    expect(within(items[1]).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(section.querySelector('img')).toBeNull();
  });

  it('has no such section when nobody remarked anything, or the card is not loaded with them', () => {
    const { unmount } = render(<CardDetail card={card('PROPOSTA_COMMUNITY', { approvazioni: 0, rilievi: [] })} onEdit={vi.fn()} onDelete={vi.fn()} onOpenAnchor={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByText('Rilievi dei validatori')).not.toBeInTheDocument();
    unmount();
    renderDetail(card('BOZZA_PERSONALE'));
    expect(screen.queryByText('Rilievi dei validatori')).not.toBeInTheDocument();
  });

  it('counts the approvals of a proposed card, and says «Validata da n» of a validated one', () => {
    const { unmount } = render(<CardDetail card={card('PROPOSTA_COMMUNITY', { approvazioni: 1, rilievi: [] })} onEdit={vi.fn()} onDelete={vi.fn()} onOpenAnchor={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText('Approvazioni: 1')).toBeInTheDocument();
    unmount();
    renderDetail(card('VALIDATA', { approvazioni: 2, rilievi: [] }));
    expect(screen.getByText('Validata da 2')).toBeInTheDocument();
    expect(screen.queryByText(/Approvazioni:/)).not.toBeInTheDocument();
  });
});
