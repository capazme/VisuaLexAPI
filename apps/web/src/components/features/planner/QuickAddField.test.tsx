import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taskService', () => ({ taskService: { create: vi.fn() } }));

import { QuickAddField } from './QuickAddField';

// «Dettagli» of the task's quick add (U1b): its fields in a panel in place under the row, the box growing.
describe('QuickAddField — «Dettagli»', () => {
  it('opens the details in place under the row and closes them with Esc, the focus back on «Dettagli»', async () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const user = userEvent.setup();
    const details = screen.getByRole('button', { name: 'Dettagli' });
    const panel = document.getElementById(details.getAttribute('aria-controls')!)!;
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveClass('grid-rows-[0fr]');
    await user.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('inert');
    expect(panel).toHaveClass('grid-rows-[1fr]');
    // Its arrow turns with it.
    expect(details.querySelector('svg.rotate-180')).not.toBeNull();
    // Esc from one of its fields (a date, a select).
    const field = panel.querySelector<HTMLElement>('input, select')!;
    field.focus();
    await user.keyboard('{Escape}');
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(details).toHaveFocus();
  });

  it('writes the title at 16 px on a phone, whatever the text size (Safari zooms under it)', () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const title = screen.getByLabelText('Nuovo compito');
    expect(title).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
    expect(title).not.toHaveClass('text-base');
  });

  it('keeps its hint whole on a narrow row, the buttons going under it (cut to «Aggiun» at 320 px in the dossier)', () => {
    render(<QuickAddField view="dossier" today="2026-10-22" defaults={{ dossierId: 'd1' }} dossierLocked />);
    const title = screen.getByLabelText('Nuovo compito');
    expect(title).toHaveClass('min-w-[11.5rem]', 'flex-1');
    expect(title.parentElement).toHaveClass('flex-wrap');
    // The two buttons wrap together, at the right.
    const buttons = screen.getByRole('button', { name: /Aggiungi/ }).parentElement!;
    expect(buttons).toHaveClass('ml-auto');
    expect(buttons).toContainElement(screen.getByRole('button', { name: /Dettagli/ }));
  });

  it('leaves the details alone when Esc empties the title', async () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const user = userEvent.setup();
    const details = screen.getByRole('button', { name: 'Dettagli' });
    await user.click(details);
    const title = screen.getByLabelText('Nuovo compito');
    await user.type(title, 'Telefonare');
    await user.keyboard('{Escape}');
    expect(title).toHaveValue('');
    expect(details).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows its state by its arrow at every width', async () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const details = screen.getByRole('button', { name: 'Dettagli' });
    // Icon and arrow in a row at every width, never stacked (the planner's icon button is a grid).
    expect(details).toHaveClass('inline-flex');
    expect(details).not.toHaveClass('inline-grid');
    const arrow = details.querySelectorAll('svg')[1];
    expect(arrow.getAttribute('class')).not.toMatch(/\bhidden\b/);
    await userEvent.click(details);
    expect(arrow).toHaveClass('rotate-180');
  });
});
