import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MissedCitationReporter } from '../MissedCitationReporter';

const RECT = { x: 40, y: 120, width: 90, height: 18 };

describe('MissedCitationReporter', () => {
  // The dialog stays visibility:hidden until floating-ui has positioned it
  // (gotcha 13), so every query waits for the first position.
  it('quotes the selection and saves only once act type and article are given', async () => {
    const onSubmit = vi.fn();
    render(
      <MissedCitationReporter anchorRect={RECT} selectedText="art. 1218 c.c." onSubmit={onSubmit} onClose={vi.fn()} />,
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent('art. 1218 c.c.');
    const save = screen.getByRole('button', { name: /^salva$/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/tipo atto citato/i), { target: { value: ' codice civile ' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/articolo citato/i), { target: { value: '1218' } });
    fireEvent.click(save);

    expect(onSubmit).toHaveBeenCalledWith({ actType: 'codice civile', article: '1218' });
  });

  it('closes on Annulla and on the close button', async () => {
    const onClose = vi.fn();
    render(<MissedCitationReporter anchorRect={RECT} selectedText="art. 7" onSubmit={vi.fn()} onClose={onClose} />);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /annulla/i }));
    fireEvent.click(screen.getByRole('button', { name: /chiudi/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
