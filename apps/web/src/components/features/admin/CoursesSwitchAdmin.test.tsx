import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/adminService', () => ({ appSwitches: vi.fn(), setAppSwitch: vi.fn() }));

import * as adminService from '../../../services/adminService';
import { coursesSwitchStore } from '../studia/corsi/coursesSwitch';
import { CoursesSwitchAdmin } from './CoursesSwitchAdmin';

const appSwitches = vi.mocked(adminService.appSwitches);
const setAppSwitch = vi.mocked(adminService.setAppSwitch);
const row = (enabled: boolean) => ({ key: 'lingo_courses', description: 'Percorsi di studio creati dall’assistente (A1).', enabled, updatedAt: null });

beforeEach(() => {
  appSwitches.mockResolvedValue([{ key: 'assistant_passages', description: 'x', enabled: true, updatedAt: null }, row(false)]);
});
afterEach(() => {
  vi.clearAllMocks();
  coursesSwitchStore.setState({ state: 'unknown' });
});

describe('CoursesSwitchAdmin (LC9)', () => {
  it('says the switch is off and turns it on through PUT /admin/switches/lingo_courses, saying the outcome', async () => {
    setAppSwitch.mockResolvedValue(row(true));
    render(<CoursesSwitchAdmin />);
    expect(await screen.findByText('I percorsi sono spenti.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accendi i percorsi' }));
    expect(setAppSwitch).toHaveBeenCalledWith('lingo_courses', true);
    expect(await screen.findByText('I percorsi sono accesi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spegni i percorsi' })).toBeInTheDocument();
    // The app's own switch follows at once: the sidebar and Oggi show the courses without a reload.
    expect(coursesSwitchStore.getState().state).toBe('on');
  });

  it('turns on with one tap, with no confirmation (LC12)', async () => {
    setAppSwitch.mockResolvedValue(row(true));
    render(<CoursesSwitchAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Accendi i percorsi' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(setAppSwitch).toHaveBeenCalledWith('lingo_courses', true);
  });

  it('asks before turning off, and writes nothing on «Annulla» (LC12)', async () => {
    appSwitches.mockResolvedValue([row(true)]);
    setAppSwitch.mockResolvedValue(row(false));
    render(<CoursesSwitchAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Spegni i percorsi' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Spegnere i percorsi?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(setAppSwitch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Spegni i percorsi' }));
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Spegni' }));
    expect(setAppSwitch).toHaveBeenCalledWith('lingo_courses', false);
    expect(await screen.findByText('I percorsi sono spenti.')).toBeInTheDocument();
  });

  it('shows the error and keeps the state when the write fails', async () => {
    setAppSwitch.mockRejectedValue({ status: 500, message: 'boom' });
    render(<CoursesSwitchAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Accendi i percorsi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non sono riuscito a cambiare l’interruttore. Riprova.');
    expect(screen.getByText('I percorsi sono spenti.')).toBeInTheDocument();
    expect(coursesSwitchStore.getState().state).toBe('unknown');
  });

  it('offers to read again when the switches cannot be read', async () => {
    appSwitches.mockRejectedValueOnce(new Error('offline'));
    render(<CoursesSwitchAdmin />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere l’interruttore dei percorsi.');
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('I percorsi sono spenti.')).toBeInTheDocument();
  });
});
