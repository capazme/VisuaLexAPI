import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { AddNoteModal } from './AddNoteModal';

describe('AddNoteModal', () => {
  it('takes a note of 4,000 characters and no more', () => {
    const onSave = vi.fn();
    render(<AddNoteModal open onClose={() => {}} onSave={onSave} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'a'.repeat(4100) } });
    expect((box as HTMLTextAreaElement).value).toHaveLength(4000);
  });
});

describe('AddNoteModal — saving', () => {
  it('keeps the text and stays open when the note is refused', async () => {
    const onClose = vi.fn();
    render(<AddNoteModal open onClose={onClose} onSave={async () => false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Una nota lunga e preziosa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aggiungi alla pratica' })).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Una nota lunga e preziosa');
  });
  it('closes once the note is saved, and names what it adds to', async () => {
    const onClose = vi.fn();
    render(<AddNoteModal open onClose={onClose} onSave={async () => true} heading="Nota su art. 3" confirmLabel="Aggiungi all'articolo" />);
    expect(screen.getByRole('region', { name: 'Nota su art. 3' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: "Aggiungi all'articolo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('AddNoteModal in the page (LC125, L-73)', () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Nota</button>
        <AddNoteModal open={open} onClose={() => setOpen(false)} onSave={() => true} />
      </>
    );
  }

  it('opens as a region with the focus on it, not in the field; Esc closes it and gives the focus back', () => {
    render(<Host />);
    const command = screen.getByRole('button', { name: 'Nota' });
    command.focus();
    fireEvent.click(command);
    const region = screen.getByRole('region', { name: 'Aggiungi una nota alla pratica' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(region);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.activeElement).toBe(command);
  });

  it('opens again with an empty field', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bozza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
