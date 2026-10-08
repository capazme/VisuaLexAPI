import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { create: vi.fn(), update: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import type { NormaVisitata } from '../../../types';
import type { Scheda } from '../../../types/studia';
import { CardForm, type CardFormMode } from './CardForm';
import { CardFormDialog } from './CardFormDialog';

const create = vi.mocked(studiaService.create);
const update = vi.mocked(studiaService.update);

const codiceCivile: NormaVisitata = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1453' };
const legge241: NormaVisitata = { tipo_atto: 'legge', data: '1990-08-07', numero_atto: '241', numero_articolo: '2' };

const draft: Scheda = {
  id: 'k1', materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: 'Quando si può chiedere la risoluzione?', risposta: 'Nei contratti con prestazioni corrispettive.', spiegazione: 'Spiegazione.',
  stato: 'BOZZA_PERSONALE', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null,
  ancore: [{ normaKey: 'codice_civile', articleId: 'art_1453', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453', isPrimary: true }],
};

/** jsdom has no viewport: the phone's layout is the default, the desktop's is chosen here. */
function setDesktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderForm(mode: CardFormMode) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(<CardForm mode={mode} onSaved={onSaved} onCancel={onCancel} />);
  return { onSaved, onCancel };
}

const fromReader = (extra: Partial<Extract<CardFormMode, { kind: 'create' }>> = {}): CardFormMode => ({ kind: 'create', norma: codiceCivile, ...extra });

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Istituto'), 'Risoluzione');
  await user.type(screen.getByLabelText('Domanda'), 'Quando?');
  await user.type(screen.getByLabelText('Risposta'), 'Se inadempiente.');
}

beforeEach(() => {
  setDesktop(true);
  create.mockReset();
  update.mockReset();
});

afterEach(() => setDesktop(false));

describe('CardForm, opened from an article', () => {
  it('anchors the card to the article, fixed, and takes the subject from the act', () => {
    renderForm(fromReader());
    const chip = screen.getByText('art. 1453 c.c.');
    expect(chip).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /togli l’ancora/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Materia')).toHaveValue('DIRITTO_CIVILE');
    expect(screen.getByText('principale')).toBeInTheDocument();
  });

  it('asks for the subject when the act implies none', () => {
    renderForm({ kind: 'create', norma: legge241 });
    expect(screen.getByLabelText('Materia')).toHaveValue('');
    expect(screen.getByText('art. 2, l. 7 agosto 1990, n. 241')).toBeInTheDocument();
  });

  it('holds the selected passage as the answer', () => {
    renderForm(fromReader({ passage: 'Nei contratti con prestazioni corrispettive…' }));
    expect(screen.getByLabelText('Risposta')).toHaveValue('Nei contratti con prestazioni corrispettive…');
  });

  it('suggests the institute from the article’s heading, and leaves it editable', async () => {
    const user = userEvent.setup();
    renderForm(fromReader({ suggestedIstituto: 'Risoluzione per inadempimento' }));
    const field = screen.getByLabelText('Istituto');
    expect(field).toHaveValue('Risoluzione per inadempimento');
    await user.clear(field);
    await user.type(field, 'Inadempimento');
    expect(field).toHaveValue('Inadempimento');
  });

  it('shows the kind as a segmented control on desktop, a select on a phone', () => {
    const { unmount } = render(<CardForm mode={fromReader()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Caso' })).toBeInTheDocument();
    unmount();
    setDesktop(false);
    render(<CardForm mode={fromReader()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('tab', { name: 'Caso' })) .not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Tipo di scheda' })).toHaveValue('ISTITUTO_DEFINIZIONE');
  });

  it('picks a kind without sending the form', async () => {
    const user = userEvent.setup();
    renderForm(fromReader());
    await user.click(screen.getByRole('tab', { name: 'Caso' }));
    expect(screen.getByRole('tab', { name: 'Caso' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Scrivi la domanda')).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an empty question on the spot and sends nothing', async () => {
    const user = userEvent.setup();
    renderForm(fromReader());
    await user.type(screen.getByLabelText('Istituto'), 'Risoluzione');
    await user.type(screen.getByLabelText('Risposta'), 'Se inadempiente.');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Scrivi la domanda')).toBeInTheDocument();
    expect(screen.getByLabelText('Domanda')).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it('asks for what is missing, field by field', async () => {
    const user = userEvent.setup();
    renderForm({ kind: 'create', norma: legge241 });
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Scegli la materia')).toBeInTheDocument();
    expect(screen.getByText('Scrivi l’istituto')).toBeInTheDocument();
    expect(screen.getByText('Scrivi la domanda')).toBeInTheDocument();
    expect(screen.getByText('Scrivi la risposta')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('counts the limit down in its last tenth and refuses what passes it', async () => {
    const user = userEvent.setup();
    renderForm(fromReader({ passage: 'a'.repeat(3_700) }));
    expect(screen.getByText('Rimangono 300 caratteri')).toBeInTheDocument();
    expect(screen.queryByText(/di troppo/)).not.toBeInTheDocument();
    renderForm(fromReader({ passage: 'a'.repeat(4_005) }));
    expect(screen.getByText('5 caratteri di troppo')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Salva' })[1]);
    expect(await screen.findByText('La risposta supera i 4.000 caratteri')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the card with the article as the primary anchor', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ outcome: 'created', id: 'new-1' });
    const { onSaved } = renderForm(fromReader());
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(create).toHaveBeenCalledWith({
      materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', tipo: 'ISTITUTO_DEFINIZIONE', domanda: 'Quando?', risposta: 'Se inadempiente.',
      ancore: [{ riferimento: 'art. 1453 c.c.', principale: true }],
    });
    expect(onSaved).toHaveBeenCalledWith('new-1');
  });

  it('puts the server’s detail under the anchor that failed and keeps the form open', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({
      outcome: 'refused', detail: 'Un’ancora non è verificabile: la scheda non è stata creata.',
      anchors: [{ outcome: 'does_not_exist', reference: 'art. 99999 c.c.', detail: 'L’articolo 99999 c.c. non esiste: correggi l’ancora.' }],
    });
    const { onSaved } = renderForm(fromReader());
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: '+ Ancora' }));
    await user.type(screen.getByLabelText('Riferimento dell’ancora'), 'art. 99999 c.c.');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    const detail = await screen.findByText('L’articolo 99999 c.c. non esiste: correggi l’ancora.');
    expect(detail.closest('li')).toHaveTextContent('art. 99999 c.c.');
    expect(within(detail.closest('li')!).getByRole('button', { name: /togli l’ancora art\. 99999 c\.c\./i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Controlla le ancore segnate');
    expect(create.mock.calls[0][0].ancore).toEqual([
      { riferimento: 'art. 1453 c.c.', principale: true },
      { riferimento: 'art. 99999 c.c.', principale: false },
    ]);
    expect(onSaved).not.toHaveBeenCalled();

    // Taking the failed anchor out clears its words, and the card goes through.
    create.mockResolvedValue({ outcome: 'created', id: 'new-2' });
    await user.click(screen.getByRole('button', { name: /togli l’ancora art\. 99999 c\.c\./i }));
    expect(screen.queryByText('L’articolo 99999 c.c. non esiste: correggi l’ancora.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSaved).toHaveBeenCalledWith('new-2');
  });

  it('keeps a reference typed but not yet added', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ outcome: 'created', id: 'new-3' });
    renderForm(fromReader());
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: '+ Ancora' }));
    await user.type(screen.getByLabelText('Riferimento dell’ancora'), 'art. 1454 c.c.');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(create.mock.calls[0][0].ancore).toEqual([
      { riferimento: 'art. 1453 c.c.', principale: true },
      { riferimento: 'art. 1454 c.c.', principale: false },
    ]);
  });

  it('does not add the same anchor twice', async () => {
    const user = userEvent.setup();
    renderForm(fromReader());
    await user.click(screen.getByRole('button', { name: '+ Ancora' }));
    await user.type(screen.getByLabelText('Riferimento dell’ancora'), 'Art.  1453   C.C.{Enter}');
    expect(screen.getByText('Questa ancora c’è già')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows a generic message when a refusal names no anchor, never the server’s raw text', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ outcome: 'refused', detail: 'Validation failed: body must be an object' });
    renderForm(fromReader());
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La scheda non è stata salvata: controlla i campi e riprova.');
    expect(screen.queryByText(/Validation failed/)).not.toBeInTheDocument();
  });

  it('says the sources are down on a 503, and keeps what was written', async () => {
    const user = userEvent.setup();
    create.mockRejectedValue({ status: 503, message: 'Le fonti non rispondono', data: { detail: 'Le fonti non rispondono' } });
    renderForm(fromReader());
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('non riesco a controllare l’articolo in questo momento. Riprova più tardi.');
    expect(screen.getByLabelText('Domanda')).toHaveValue('Quando?');
    expect(screen.getByRole('button', { name: 'Salva' })).toBeEnabled();
  });

  it('keeps the question <img src=x onerror=alert(1)> as literal text', async () => {
    const user = userEvent.setup();
    const question = '<img src=x onerror=alert(1)>';
    create.mockResolvedValue({ outcome: 'created', id: 'new-4' });
    const { container } = render(<CardForm mode={fromReader()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Istituto'), 'Risoluzione');
    await user.click(screen.getByLabelText('Domanda'));
    await user.paste(question);
    await user.type(screen.getByLabelText('Risposta'), 'Se inadempiente.');
    expect(container.querySelector('img')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(create.mock.calls[0][0].domanda).toBe(question);
  });
});

describe('CardForm, editing a draft', () => {
  it('opens on the card, with its anchors as chips the person can take out', async () => {
    const user = userEvent.setup();
    renderForm({ kind: 'edit', card: draft });
    expect(screen.getByLabelText('Materia')).toHaveValue('DIRITTO_CIVILE');
    expect(screen.getByLabelText('Istituto')).toHaveValue('Risoluzione per inadempimento');
    expect(screen.getByLabelText('Domanda')).toHaveValue('Quando si può chiedere la risoluzione?');
    expect(screen.getByLabelText(/Spiegazione/)).toHaveValue('Spiegazione.');
    expect(screen.getByText('art. 1453 c.c.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /togli l’ancora art\. 1453 c\.c\./i }));
    expect(screen.queryByText('art. 1453 c.c.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Aggiungi almeno un’ancora')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('replaces the primary anchor and saves with update', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue({ outcome: 'updated', card: { ...draft, istituto: 'Risoluzione' } });
    const { onSaved } = renderForm({ kind: 'edit', card: draft });
    await user.click(screen.getByRole('button', { name: /togli l’ancora art\. 1453 c\.c\./i }));
    await user.click(screen.getByRole('button', { name: '+ Ancora' }));
    await user.type(screen.getByLabelText('Riferimento dell’ancora'), 'art. 1454 c.c.{Enter}');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(update).toHaveBeenCalledWith('k1', {
      materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione per inadempimento', tipo: 'ISTITUTO_DEFINIZIONE',
      domanda: 'Quando si può chiedere la risoluzione?', risposta: 'Nei contratti con prestazioni corrispettive.', spiegazione: 'Spiegazione.',
      ancore: [{ riferimento: 'art. 1454 c.c.', principale: true }],
    });
    expect(create).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith('k1');
  });

  it('shows the question <img src=x onerror=alert(1)> of a stored card as literal text', () => {
    const { container } = render(
      <CardForm mode={{ kind: 'edit', card: { ...draft, domanda: '<img src=x onerror=alert(1)>' } }} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByLabelText('Domanda')).toHaveValue('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });

  it('says the card is gone on a 404 and is no longer a draft on a 409', async () => {
    const user = userEvent.setup();
    update.mockRejectedValue({ status: 404, message: 'Scheda non trovata.' });
    renderForm({ kind: 'edit', card: draft });
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La scheda non esiste più');
    update.mockRejectedValue({ status: 409, message: 'Solo una bozza si può modificare.' });
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText(/non è più una bozza/)).toBeInTheDocument();
  });
});

describe('CardFormDialog', () => {
  it.each([
    ['desktop', true],
    ['phone', false],
  ])('saves, closes and says «Scheda salvata» on %s', async (_name, desktop) => {
    setDesktop(desktop);
    const user = userEvent.setup();
    create.mockResolvedValue({ outcome: 'created', id: 'new-5' });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<CardFormDialog open onClose={onClose} mode={fromReader()} onSaved={onSaved} />);
    expect(screen.getByRole('dialog', { name: 'Nuova scheda' })).toBeInTheDocument();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSaved).toHaveBeenCalledWith('new-5');
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Scheda salvata')).toBeInTheDocument();
  });

  it('is called «Modifica scheda» for a draft and closes on Annulla', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CardFormDialog open onClose={onClose} mode={{ kind: 'edit', card: draft }} onSaved={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Modifica scheda' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('draws nothing while closed', () => {
    render(<CardFormDialog open={false} onClose={vi.fn()} mode={fromReader()} onSaved={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
