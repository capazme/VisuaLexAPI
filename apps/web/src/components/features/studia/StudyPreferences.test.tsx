import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { preferences: vi.fn(), savePreferences: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import { StudyPreferences } from './StudyPreferences';

const preferences = vi.mocked(studiaService.preferences);
const savePreferences = vi.mocked(studiaService.savePreferences);

async function opened(onChanged = vi.fn()) {
  render(<StudyPreferences onChanged={onChanged} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
  await screen.findByLabelText('Nuove schede al giorno');
  return { user, onChanged };
}

beforeEach(() => {
  preferences.mockReset();
  savePreferences.mockReset();
  preferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: [] });
});

describe('StudyPreferences', () => {
  it('is closed at first, and opens from its heading', async () => {
    render(<StudyPreferences onChanged={() => {}} />);
    const toggle = screen.getByRole('button', { name: 'Impostazioni dello studio' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const goal = await screen.findByLabelText('Nuove schede al giorno');
    expect(goal).not.toBeVisible();
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(goal).toBeVisible();
  });

  describe('the daily goal', () => {
    it('shows the goal in force and saves a new one in range', async () => {
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 35, ripassiAlGiorno: 10, materieComunita: [] });
      const { user, onChanged } = await opened();
      const goal = screen.getByLabelText('Nuove schede al giorno');
      expect(goal).toHaveValue(20);
      await user.clear(goal);
      await user.type(goal, '35');
      await user.click(screen.getByRole('button', { name: 'Salva: nuove schede al giorno' }));
      expect(savePreferences).toHaveBeenCalledWith({ nuoveAlGiorno: 35 });
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('status')).toHaveTextContent('Salvato');
    });

    it.each(['0', '201', '', '2.5', '-3'])('refuses %j with a message, and sends nothing', async (text) => {
      const { user, onChanged } = await opened();
      const goal = screen.getByLabelText('Nuove schede al giorno');
      await user.clear(goal);
      if (text) await user.type(goal, text);
      await user.click(screen.getByRole('button', { name: 'Salva: nuove schede al giorno' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Inserisci un numero da 1 a 200.');
      expect(goal).toHaveAttribute('aria-invalid', 'true');
      expect(savePreferences).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('accepts the ends of the range', async () => {
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 200, ripassiAlGiorno: 10, materieComunita: [] });
      const { user } = await opened();
      const goal = screen.getByLabelText('Nuove schede al giorno');
      await user.clear(goal);
      await user.type(goal, '200');
      await user.click(screen.getByRole('button', { name: 'Salva: nuove schede al giorno' }));
      expect(savePreferences).toHaveBeenCalledWith({ nuoveAlGiorno: 200 });
    });
  });

  describe('the review goal of the streak', () => {
    it('shows the goal in force with what it means, and saves a new one on its own', async () => {
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 15, materieComunita: [] });
      const { user, onChanged } = await opened();
      const goal = screen.getByLabelText('Ripassi al giorno');
      expect(goal).toHaveValue(10);
      expect(goal).toHaveAccessibleDescription('Quanti ripassi tengono viva la serie. Vale anche finire le schede del giorno.');
      await user.clear(goal);
      await user.type(goal, '15');
      await user.click(screen.getByRole('button', { name: 'Salva: ripassi al giorno' }));
      expect(savePreferences).toHaveBeenCalledWith({ ripassiAlGiorno: 15 });
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(screen.getByLabelText('Nuove schede al giorno')).toHaveValue(20);
    });

    it('refuses a number out of range', async () => {
      const { user } = await opened();
      const goal = screen.getByLabelText('Ripassi al giorno');
      await user.clear(goal);
      await user.type(goal, '0');
      await user.click(screen.getByRole('button', { name: 'Salva: ripassi al giorno' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Inserisci un numero da 1 a 200.');
      expect(savePreferences).not.toHaveBeenCalled();
    });
  });

  describe('the community’s subjects', () => {
    it('explains the switches and has one for each subject, all off at first', async () => {
      await opened();
      expect(screen.getByText('Schede validate dalla comunità, per materia')).toBeInTheDocument();
      const switches = screen.getAllByRole('switch');
      expect(switches.map((s) => s.textContent)).toEqual([
        'Diritto civile', 'Diritto penale', 'Diritto amministrativo', 'Diritto processuale civile', 'Diritto processuale penale',
      ]);
      switches.forEach((s) => expect(s).toHaveAttribute('aria-checked', 'false'));
    });

    it('sends a subject switched on, shows what the server kept, and tells the view to count again', async () => {
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE'] });
      const { user, onChanged } = await opened();
      await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
      expect(savePreferences).toHaveBeenCalledWith({ materieComunita: ['DIRITTO_CIVILE'] });
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Diritto civile' })).toHaveAttribute('aria-checked', 'true'));
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('switch', { name: 'Diritto penale' })).toHaveAttribute('aria-checked', 'false');
    });

    it('does not report on the daily goal, nor overwrite a goal being typed', async () => {
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE'] });
      const { user } = await opened();
      const goal = screen.getByLabelText('Nuove schede al giorno');
      await user.clear(goal);
      await user.type(goal, '45');
      await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Diritto civile' })).toHaveAttribute('aria-checked', 'true'));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(goal).toHaveValue(45);
    });

    it('switches one off, keeping the others', async () => {
      preferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_CIVILE', 'DIRITTO_PENALE'] });
      savePreferences.mockResolvedValue({ nuoveAlGiorno: 20, ripassiAlGiorno: 10, materieComunita: ['DIRITTO_PENALE'] });
      const { user } = await opened();
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Diritto civile' })).toHaveAttribute('aria-checked', 'true'));
      await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
      expect(savePreferences).toHaveBeenCalledWith({ materieComunita: ['DIRITTO_PENALE'] });
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Diritto civile' })).toHaveAttribute('aria-checked', 'false'));
    });

    it('leaves the switch as it was, and says so, when the server refuses', async () => {
      savePreferences.mockRejectedValue(new Error('down'));
      const { user, onChanged } = await opened();
      await user.click(screen.getByRole('switch', { name: 'Diritto civile' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Non sono riuscito a salvare. Riprova.');
      expect(screen.getByRole('switch', { name: 'Diritto civile' })).toHaveAttribute('aria-checked', 'false');
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  it('says so when the settings cannot be read, and shows no controls', async () => {
    preferences.mockRejectedValue(new Error('down'));
    render(<StudyPreferences onChanged={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Impostazioni dello studio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere le impostazioni.');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
