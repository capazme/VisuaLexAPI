import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/adminService', () => ({
  studiaSoglie: vi.fn(),
  previewStudiaSoglie: vi.fn(),
  saveStudiaSoglie: vi.fn(),
}));

import * as adminService from '../../../services/adminService';
import type { StudiaSoglieSettings } from '../../../services/adminService';
import { StudiaSoglieAdmin } from './StudiaSoglieAdmin';

const studiaSoglie = vi.mocked(adminService.studiaSoglie);
const previewStudiaSoglie = vi.mocked(adminService.previewStudiaSoglie);
const saveStudiaSoglie = vi.mocked(adminService.saveStudiaSoglie);

const SETTINGS: StudiaSoglieSettings = {
  soglie: { approvazioni: 2, errate: 1 },
  limiti: { approvazioni: { min: 1, max: 5 }, errate: { min: 1, max: 3 } },
  predefinite: { approvazioni: 2, errate: 1 },
};

beforeEach(() => {
  studiaSoglie.mockReset();
  previewStudiaSoglie.mockReset();
  saveStudiaSoglie.mockReset();
  studiaSoglie.mockResolvedValue(SETTINGS);
  previewStudiaSoglie.mockResolvedValue({ validate: 3, archiviate: 1 });
});

async function renderSection() {
  render(<StudiaSoglieAdmin />);
  await screen.findByRole('region', { name: 'Soglie di validazione' });
  return {
    approvazioni: screen.getByLabelText('Approvazioni per validare') as HTMLInputElement,
    errate: screen.getByLabelText('«Errata» per archiviare') as HTMLInputElement,
    salva: screen.getByRole('button', { name: 'Salva' }),
  };
}

describe('StudiaSoglieAdmin, the values in force', () => {
  it('shows the stored values and the defaults, and nothing to save yet', async () => {
    const { approvazioni, errate, salva } = await renderSection();
    expect(approvazioni.value).toBe('2');
    expect(errate.value).toBe('1');
    expect(screen.getByText('Predefinito: 2')).toBeInTheDocument();
    expect(screen.getByText('Predefinito: 1')).toBeInTheDocument();
    expect(screen.getByText('Le soglie in vigore sono 2 approvazioni e 1 «errata».')).toBeInTheDocument();
    expect(salva).toBeDisabled();
    expect(previewStudiaSoglie).not.toHaveBeenCalled();
  });

  it('offers to read the values again when they cannot be read', async () => {
    studiaSoglie.mockRejectedValueOnce(new Error('offline'));
    render(<StudiaSoglieAdmin />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere le soglie. Riprova.');
    studiaSoglie.mockResolvedValueOnce(SETTINGS);
    screen.getByRole('button', { name: 'Riprova' }).click();
    expect(await screen.findByLabelText('Approvazioni per validare')).toHaveValue(2);
  });
});

describe('StudiaSoglieAdmin, the preview', () => {
  it('shows what the new values would do to the proposed cards before saving', async () => {
    const user = userEvent.setup();
    const { approvazioni, salva } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '3');
    expect(await screen.findByText('Con questa soglia 3 schede diventano validate e 1 archiviata.')).toBeInTheDocument();
    expect(previewStudiaSoglie).toHaveBeenLastCalledWith({ approvazioni: 3, errate: 1 });
    expect(salva).toBeEnabled();
  });

  it('keeps the preview when the same number is typed again ("03" for 3)', async () => {
    const user = userEvent.setup();
    const { approvazioni } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '3');
    await screen.findByText('Con questa soglia 3 schede diventano validate e 1 archiviata.');
    await user.clear(approvazioni);
    await user.type(approvazioni, '03');
    expect(screen.getByText('Con questa soglia 3 schede diventano validate e 1 archiviata.')).toBeInTheDocument();
    expect(screen.queryByText('Calcolo l’effetto…')).not.toBeInTheDocument();
  });

  it('refuses a value out of its range, in Italian, and asks nothing of the server', async () => {
    const user = userEvent.setup();
    const { approvazioni, errate, salva } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '6');
    expect(screen.getByText('Da 1 a 5.')).toBeInTheDocument();
    await user.clear(errate);
    await user.type(errate, '0');
    expect(screen.getByText('Da 1 a 3.')).toBeInTheDocument();
    expect(salva).toBeDisabled();
    expect(previewStudiaSoglie).not.toHaveBeenCalled();
  });

  it('says when the preview cannot be read, and keeps saving off', async () => {
    const user = userEvent.setup();
    previewStudiaSoglie.mockRejectedValueOnce(new Error('boom'));
    const { errate, salva } = await renderSection();
    await user.clear(errate);
    await user.type(errate, '2');
    expect(await screen.findByText('Non riesco a calcolare l’effetto. Modifica il valore per riprovare.')).toBeInTheDocument();
    expect(salva).toBeDisabled();
  });
});

describe('StudiaSoglieAdmin, the review fixes', () => {
  it('a value whose preview failed works again once it is asked for again', async () => {
    const user = userEvent.setup();
    previewStudiaSoglie.mockRejectedValueOnce(new Error('boom'));
    const { approvazioni, salva } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '3');
    expect(await screen.findByText('Non riesco a calcolare l’effetto. Modifica il valore per riprovare.')).toBeInTheDocument();
    await user.clear(approvazioni);
    await user.type(approvazioni, '4');
    await screen.findByText('Con questa soglia 3 schede diventano validate e 1 archiviata.');
    await user.clear(approvazioni);
    await user.type(approvazioni, '3');
    expect(await screen.findByText('Con questa soglia 3 schede diventano validate e 1 archiviata.')).toBeInTheDocument();
    expect(screen.queryByText('Non riesco a calcolare l’effetto. Modifica il valore per riprovare.')).not.toBeInTheDocument();
    await waitFor(() => expect(salva).toBeEnabled());
  });

  it('shows the server’s own message when it refuses a save with 400', async () => {
    const user = userEvent.setup();
    saveStudiaSoglie.mockRejectedValue({ status: 400, message: 'Le errate vanno da 1 a 3.' });
    const { approvazioni, salva } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '3');
    await waitFor(() => expect(salva).toBeEnabled());
    await user.click(salva);
    expect(await screen.findByText('Le errate vanno da 1 a 3.')).toBeInTheDocument();
  });

  it('locks both fields while the save is in flight, so a value typed then is not lost', async () => {
    const user = userEvent.setup();
    let finish: (value: { soglie: { approvazioni: number; errate: number }; validate: number; archiviate: number }) => void = () => {};
    saveStudiaSoglie.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { approvazioni, errate, salva } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '3');
    await waitFor(() => expect(salva).toBeEnabled());
    await user.click(salva);
    expect(approvazioni).toBeDisabled();
    expect(errate).toBeDisabled();
    finish({ soglie: { approvazioni: 3, errate: 1 }, validate: 0, archiviate: 0 });
    await screen.findByText('Soglie salvate. 0 schede validate, 0 archiviate.');
    expect(approvazioni).toBeEnabled();
  });

  it('gives the two buttons the 44 px touch target a phone needs', async () => {
    await renderSection();
    expect(screen.getByRole('button', { name: 'Salva' }).className).toContain('min-h-[44px]');
  });

  it('writes one card in the singular', async () => {
    const user = userEvent.setup();
    previewStudiaSoglie.mockResolvedValue({ validate: 1, archiviate: 0 });
    const { approvazioni } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '1');
    expect(await screen.findByText('Con questa soglia 1 scheda diventa validata e 0 archiviate.')).toBeInTheDocument();
  });
});

describe('StudiaSoglieAdmin, saving', () => {
  it('saves both values and reports the counts applied', async () => {
    const user = userEvent.setup();
    saveStudiaSoglie.mockResolvedValue({ soglie: { approvazioni: 3, errate: 1 }, validate: 3, archiviate: 1 });
    const { approvazioni, salva } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '3');
    await waitFor(() => expect(salva).toBeEnabled());
    await user.click(salva);
    expect(saveStudiaSoglie).toHaveBeenCalledWith({ approvazioni: 3, errate: 1 });
    expect(await screen.findByText('Soglie salvate. 3 schede validate, 1 archiviata.')).toBeInTheDocument();
    expect(await screen.findByText('Le soglie in vigore sono 3 approvazioni e 1 «errata».')).toBeInTheDocument();
    expect(salva).toBeDisabled();
  });

  it('says so when the save fails, and keeps what was typed', async () => {
    const user = userEvent.setup();
    saveStudiaSoglie.mockRejectedValue(new Error('server down'));
    const { approvazioni, salva } = await renderSection();
    await user.clear(approvazioni);
    await user.type(approvazioni, '4');
    await waitFor(() => expect(salva).toBeEnabled());
    await user.click(salva);
    expect(await screen.findByText('Non sono riuscito a salvare le soglie. Riprova.')).toBeInTheDocument();
    expect(approvazioni.value).toBe('4');
    await waitFor(() => expect(salva).toBeEnabled());
  });
});
