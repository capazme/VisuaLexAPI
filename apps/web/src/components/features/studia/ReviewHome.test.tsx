import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { session: vi.fn(), preferences: vi.fn(), savePreferences: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import { ReviewHome } from './ReviewHome';

const session = vi.mocked(studiaService.session);
const preferences = vi.mocked(studiaService.preferences);
const savePreferences = vi.mocked(studiaService.savePreferences);

const counts = (dovute: number, nuove: number) => ({ conteggi: { dovute, nuove }, cards: [] });

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/studia/ripasso']}>
      <Routes>
        <Route path="/studia/ripasso" element={<ReviewHome />} />
        <Route path="/studia/ripasso/sessione" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  session.mockReset();
  preferences.mockReset();
  savePreferences.mockReset();
  preferences.mockResolvedValue({ nuoveAlGiorno: 20, materieComunita: [] });
});

describe('ReviewHome', () => {
  it('says what is on today and offers to start', async () => {
    session.mockResolvedValue(counts(18, 20));
    renderHome();
    expect(await screen.findByText('Oggi: 18 da ripassare · 20 nuove')).toBeInTheDocument();
    expect(session).toHaveBeenCalledWith(undefined);
    const start = screen.getByRole('button', { name: 'Inizia il ripasso' });
    expect(start).toBeEnabled();
    await userEvent.setup().click(start);
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione');
    expect(screen.getByTestId('where').textContent).not.toContain('materia');
  });

  it('counts again for the subject chosen, and starts the session on it', async () => {
    session.mockResolvedValue(counts(18, 20));
    renderHome();
    await screen.findByText('Oggi: 18 da ripassare · 20 nuove');
    const select = screen.getByRole('combobox', { name: 'Materia' });
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Tutte le materie' })).toBeInTheDocument();

    session.mockResolvedValue(counts(2, 5));
    await userEvent.setup().selectOptions(select, 'Diritto penale');
    expect(await screen.findByText('Oggi: 2 da ripassare · 5 nuove')).toBeInTheDocument();
    expect(session).toHaveBeenLastCalledWith('DIRITTO_PENALE');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Inizia il ripasso' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso/sessione?materia=DIRITTO_PENALE');
  });

  it('does not offer a start when nothing is due and nothing is new', async () => {
    session.mockResolvedValue(counts(0, 0));
    renderHome();
    expect(await screen.findByText('Per oggi hai finito. Le prossime schede tornano domani.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeDisabled();
  });

  it('starts with new cards alone, or due cards alone', async () => {
    session.mockResolvedValue(counts(0, 7));
    renderHome();
    await screen.findByText('Oggi: 0 da ripassare · 7 nuove');
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeEnabled();
    expect(screen.queryByText(/Per oggi hai finito/)).not.toBeInTheDocument();
  });

  it('says so, and reads again on request, when the counts cannot be read', async () => {
    session.mockRejectedValueOnce(new Error('down'));
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Non riesco a leggere le schede di oggi.');
    expect(alert.textContent).not.toMatch(/Riprova\.\s*Riprova/);
    expect(screen.getByRole('button', { name: 'Inizia il ripasso' })).toBeDisabled();
    session.mockResolvedValue(counts(1, 0));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Oggi: 1 da ripassare · 0 nuove')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('counts again, and shows the new counts, after a community subject is switched on', async () => {
    session.mockResolvedValue(counts(3, 0));
    renderHome();
    await screen.findByText('Oggi: 3 da ripassare · 0 nuove');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
    session.mockResolvedValue(counts(3, 12));
    savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, materieComunita: ['DIRITTO_CIVILE'] });
    await user.click(await screen.findByRole('switch', { name: 'Diritto civile' }));
    expect(savePreferences).toHaveBeenCalledWith({ materieComunita: ['DIRITTO_CIVILE'] });
    expect(await screen.findByText('Oggi: 3 da ripassare · 12 nuove')).toBeInTheDocument();
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('never lets a slow answer for a subject chosen before overwrite the one that came after', async () => {
    const pending: Array<(value: ReturnType<typeof counts>) => void> = [];
    session.mockResolvedValueOnce(counts(1, 1));
    renderHome();
    await screen.findByText('Oggi: 1 da ripassare · 1 nuove');
    session.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    const user = userEvent.setup();
    const select = screen.getByRole('combobox', { name: 'Materia' });
    await user.selectOptions(select, 'Diritto penale');
    await user.selectOptions(select, 'Diritto civile');
    expect(pending).toHaveLength(2);
    // The newer request answers first, the older one after.
    pending[1](counts(7, 7));
    expect(await screen.findByText('Oggi: 7 da ripassare · 7 nuove')).toBeInTheDocument();
    pending[0](counts(9, 9));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('Oggi: 7 da ripassare · 7 nuove')).toBeInTheDocument();
    expect(screen.queryByText('Oggi: 9 da ripassare · 9 nuove')).not.toBeInTheDocument();
  });

  it('holds the study settings under it', async () => {
    session.mockResolvedValue(counts(1, 1));
    renderHome();
    expect(await screen.findByRole('button', { name: 'Impostazioni dello studio' })).toBeInTheDocument();
  });
});
