import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/taskService', () => ({ taskService: { create: vi.fn().mockResolvedValue({}) } }));

import { taskService } from '../../services/taskService';
import { DeadlineCard } from './DeadlineCard';

describe('DeadlineCard', () => {
  it('shows the deadline with its calculation and puts it in the dossier agenda', async () => {
    render(<DeadlineCard dossierId="d1" />);
    const user = userEvent.setup();
    expect(screen.getByText('Scegli la data per vedere la scadenza.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Data della notifica della sentenza'), '2026-12-15');
    expect(screen.getByText('Appello entro giovedì 14 gennaio 2027')).toBeInTheDocument();
    expect(screen.getByText(/30 giorni dalla notifica del 15 dicembre 2026 · art\. 325 c\.p\.c\./)).toBeInTheDocument();
    expect(screen.getByText(/Calcolo indicativo: verifica sempre il termine/)).toBeInTheDocument();

    const steps = screen.getByRole('button', { name: 'Mostra il calcolo' });
    expect(steps).toHaveAttribute('aria-expanded', 'false');
    await user.click(steps);
    expect(screen.getByRole('button', { name: 'Nascondi il calcolo' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Scadenza: giovedì 14 gennaio 2027.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aggiungi all’agenda' }));
    expect(taskService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Appello entro il 14 gennaio 2027', dueDate: '2027-01-14', dossierId: 'd1', origin: 'lavoro' }),
    );
    expect(await screen.findByText('In agenda')).toBeInTheDocument();

    // A change of the inputs offers the button again.
    await user.selectOptions(screen.getByLabelText('Impugnazione'), 'cassazione');
    expect(screen.getByRole('button', { name: 'Aggiungi all’agenda' })).toBeInTheDocument();
  });

  it('skips the suspension when the matter is excluded', async () => {
    render(<DeadlineCard dossierId="d1" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Data della notifica della sentenza'), '2026-07-15');
    expect(screen.getByText(/lunedì 14 settembre 2026/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Materia esclusa dalla sospensione feriale/));
    expect(screen.getByText(/venerdì 14 agosto 2026/)).toBeInTheDocument();
  });
});
