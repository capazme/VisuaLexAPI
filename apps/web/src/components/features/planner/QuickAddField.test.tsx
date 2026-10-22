import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taskService', () => ({ taskService: { create: vi.fn() } }));

import { QuickAddField } from './QuickAddField';

// «Dettagli» of the task's quick add (U1b): its fields in a panel in place under the row, the box growing.
describe('QuickAddField — «Dettagli»', () => {
  it('opens the details in place under the row and closes them with Esc, the focus back on «Dettagli»', async () => {
    render(<QuickAddField view="oggi" today="2026-10-22" defaults={{}} />);
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
    render(<QuickAddField view="oggi" today="2026-10-22" defaults={{}} />);
    const title = screen.getByLabelText('Nuovo compito');
    expect(title).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
    expect(title).not.toHaveClass('text-base');
  });
});
