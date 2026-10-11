import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/adminService', () => ({
  studiaTexts: vi.fn(),
  saveStudiaText: vi.fn(),
}));

import * as adminService from '../../../services/adminService';
import type { StudiaTextGroup, StudiaTextVersion } from '../../../services/adminService';
import { StudiaTextsAdmin } from './StudiaTextsAdmin';

const studiaTexts = vi.mocked(adminService.studiaTexts);
const saveStudiaText = vi.mocked(adminService.saveStudiaText);

const version = (n: number, extra: Partial<StudiaTextVersion> = {}): StudiaTextVersion => ({
  id: `id${n}`, versione: n, titolo: `Titolo v${n}`, corpo: `Primo paragrafo v${n}.\n\nSecondo paragrafo v${n}.`,
  conferma: `Casella v${n}`, azione: `Pulsante v${n}`, createdAt: `2026-10-0${n}T10:00:00Z`, autore: n === 1 ? null : `Admin ${n}`,
  ...extra,
});

// Newest first, as the server answers.
const GROUP: StudiaTextGroup = { chiave: 'PROPOSTA_SCHEDA', versioni: [version(3), version(2), version(1)] };

beforeEach(() => {
  studiaTexts.mockReset();
  saveStudiaText.mockReset();
  studiaTexts.mockResolvedValue([GROUP]);
});

async function renderAdmin() {
  render(<StudiaTextsAdmin />);
  return screen.findByRole('region', { name: 'Avviso per proporre una scheda' });
}

describe('StudiaTextsAdmin, the current version', () => {
  it('shows each text in a form filled with its current version', async () => {
    const section = await renderAdmin();
    expect(screen.getByRole('heading', { level: 2, name: 'Testi di VisuaLex Studia' })).toBeInTheDocument();
    expect(within(section).getByLabelText('Titolo')).toHaveValue('Titolo v3');
    expect(within(section).getByLabelText('Testo')).toHaveValue('Primo paragrafo v3.\n\nSecondo paragrafo v3.');
    expect(within(section).getByLabelText('Etichetta della casella')).toHaveValue('Casella v3');
    expect(within(section).getByLabelText('Etichetta del pulsante')).toHaveValue('Pulsante v3');
    expect(within(section).getByText('Versione attuale: 3')).toBeInTheDocument();
  });

  it('previews it as the user will see it, and follows what is typed, as plain text', async () => {
    const section = await renderAdmin();
    const preview = within(section).getByRole('group', { name: 'Anteprima' });
    expect(Array.from(preview.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Primo paragrafo v3.', 'Secondo paragrafo v3.']);
    expect(within(preview).getByText('Titolo v3')).toBeInTheDocument();
    expect(within(preview).getByText('Casella v3')).toBeInTheDocument();
    expect(within(preview).getByText('Pulsante v3')).toBeInTheDocument();

    const body = within(section).getByLabelText('Testo');
    await userEvent.setup().clear(body);
    await userEvent.setup().click(body);
    await userEvent.setup().paste('<b>x</b>\n\nDue');
    expect(within(preview).getByText('<b>x</b>')).toBeInTheDocument();
    expect(within(preview).getByText('Due')).toBeInTheDocument();
    expect(preview.querySelector('b')).toBeNull();
  });

  it('keeps «Salva come nuova versione» disabled until something changed and no field is empty', async () => {
    const user = userEvent.setup();
    const section = await renderAdmin();
    const save = within(section).getByRole('button', { name: 'Salva come nuova versione' });
    expect(save).toBeDisabled();
    const title = within(section).getByLabelText('Titolo');
    await user.type(title, '!');
    expect(save).toBeEnabled();
    await user.clear(title);
    expect(save).toBeDisabled();
  });
});

describe('StudiaTextsAdmin, saving', () => {
  it('asks first, in the words of the spec with the real number, and posts nothing on «Annulla»', async () => {
    const user = userEvent.setup();
    const section = await renderAdmin();
    await user.type(within(section).getByLabelText('Titolo'), '!');
    await user.click(within(section).getByRole('button', { name: 'Salva come nuova versione' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Si crea la versione 4. Chi ha accettato una versione precedente la vedrà di nuovo alla prossima proposta. Le versioni precedenti restano consultabili.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(saveStudiaText).not.toHaveBeenCalled();
  });

  it('posts the four fields as edited, says which version was saved and shows it as current with no second read', async () => {
    const user = userEvent.setup();
    const section = await renderAdmin();
    await user.type(within(section).getByLabelText('Titolo'), '!');
    await user.type(within(section).getByLabelText('Etichetta del pulsante'), '?');
    const saved = version(4, { titolo: 'Titolo v3!', corpo: 'Primo paragrafo v3.\n\nSecondo paragrafo v3.', conferma: 'Casella v3', azione: 'Pulsante v3?' });
    saveStudiaText.mockResolvedValue(saved);

    await user.click(within(section).getByRole('button', { name: 'Salva come nuova versione' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(saveStudiaText).toHaveBeenCalledWith('PROPOSTA_SCHEDA', {
      titolo: 'Titolo v3!', corpo: 'Primo paragrafo v3.\n\nSecondo paragrafo v3.', conferma: 'Casella v3', azione: 'Pulsante v3?',
    }));
    expect(await screen.findByText('Versione 4 salvata')).toBeInTheDocument();
    expect(screen.getByText('Versione attuale: 4')).toBeInTheDocument();
    // The form never went back to the old version: it holds what was saved, and it is not «changed».
    expect(within(section).getByLabelText('Titolo')).toHaveValue('Titolo v3!');
    expect(within(section).getByRole('button', { name: 'Salva come nuova versione' })).toBeDisabled();
    // The old current version is now the first of the earlier ones.
    expect(within(within(section).getByRole('list', { name: 'Versioni precedenti' })).getAllByRole('listitem')).toHaveLength(3);
    expect(studiaTexts).toHaveBeenCalledTimes(1);
  });

  it('says another version was saved meanwhile on a 409, and on «Ricarica» shows the new version but keeps what was typed', async () => {
    const user = userEvent.setup();
    const section = await renderAdmin();
    await user.type(within(section).getByLabelText('Titolo'), '!');
    await user.type(within(section).getByLabelText('Testo'), ' Aggiunta.');
    saveStudiaText.mockRejectedValue({ status: 409, data: {} });
    await user.click(within(section).getByRole('button', { name: 'Salva come nuova versione' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salva' }));

    expect(await screen.findByText(/Un’altra versione è stata salvata nel frattempo/)).toHaveTextContent('le tue modifiche restano nel modulo');
    const after: StudiaTextGroup = { chiave: 'PROPOSTA_SCHEDA', versioni: [version(4), ...GROUP.versioni] };
    studiaTexts.mockResolvedValue([after]);
    await user.click(screen.getByRole('button', { name: 'Ricarica' }));
    await waitFor(() => expect(screen.getByText('Versione attuale: 4')).toBeInTheDocument());
    expect(screen.queryByText(/Un’altra versione/)).not.toBeInTheDocument();
    const reloaded = screen.getByRole('region', { name: 'Avviso per proporre una scheda' });
    expect(within(reloaded).getByLabelText('Titolo')).toHaveValue('Titolo v3!');
    expect(within(reloaded).getByLabelText('Testo')).toHaveValue('Primo paragrafo v3.\n\nSecondo paragrafo v3. Aggiunta.');
    // Still unsaved against the new version, so it can be saved as version 5.
    expect(within(reloaded).getByRole('button', { name: 'Salva come nuova versione' })).toBeEnabled();
  });

  it('says plainly when saving failed for another reason', async () => {
    const user = userEvent.setup();
    const section = await renderAdmin();
    await user.type(within(section).getByLabelText('Titolo'), '!');
    saveStudiaText.mockRejectedValue({ status: 500 });
    await user.click(within(section).getByRole('button', { name: 'Salva come nuova versione' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Non sono riuscito a salvare la versione. Riprova.')).toBeInTheDocument();
  });
});

describe('StudiaTextsAdmin, the earlier versions', () => {
  it('lists them newest first with number, date and author, «—» when there is none', async () => {
    const section = await renderAdmin();
    const items = within(within(section).getByRole('list', { name: 'Versioni precedenti' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Versione 2');
    expect(items[0]).toHaveTextContent('02/10/2026');
    expect(items[0]).toHaveTextContent('Admin 2');
    expect(items[1]).toHaveTextContent('Versione 1');
    expect(items[1]).toHaveTextContent('01/10/2026');
    expect(items[1]).toHaveTextContent('—');
  });

  it('opens one read-only, and shows its markup as text', async () => {
    const user = userEvent.setup();
    studiaTexts.mockResolvedValue([{ chiave: 'PROPOSTA_SCHEDA', versioni: [version(2), version(1, { corpo: '<b>x</b>\n\nDue' })] }]);
    const section = await renderAdmin();
    const toggle = within(section).getByRole('button', { name: /Versione 1/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const opened = within(section).getByRole('group', { name: 'Versione 1' });
    expect(within(opened).getByText('<b>x</b>')).toBeInTheDocument();
    expect(within(opened).getByText('Due')).toBeInTheDocument();
    expect(within(opened).getByText('Titolo v1')).toBeInTheDocument();
    expect(opened.querySelector('b')).toBeNull();
    expect(within(opened).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(within(section).queryByRole('group', { name: 'Versione 1' })).not.toBeInTheDocument();
  });
});

describe('StudiaTextsAdmin, loading', () => {
  it('says when the texts cannot be read, and tries again', async () => {
    const user = userEvent.setup();
    studiaTexts.mockRejectedValueOnce(new Error('down'));
    render(<StudiaTextsAdmin />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere i testi. Riprova.');
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('region', { name: 'Avviso per proporre una scheda' })).toBeInTheDocument();
  });

  it('names a key it does not know by the key itself', async () => {
    studiaTexts.mockResolvedValue([{ chiave: 'ALTRO_TESTO', versioni: [version(1)] }]);
    render(<StudiaTextsAdmin />);
    expect(await screen.findByRole('region', { name: 'ALTRO_TESTO' })).toBeInTheDocument();
  });
});
