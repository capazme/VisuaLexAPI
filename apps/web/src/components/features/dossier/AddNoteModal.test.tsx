import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddNoteModal } from './AddNoteModal';

describe('AddNoteModal', () => {
  it('takes a note of 4,000 characters and no more', () => {
    const onSave = vi.fn();
    render(<AddNoteModal onClose={() => {}} onSave={onSave} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'a'.repeat(4100) } });
    expect((box as HTMLTextAreaElement).value).toHaveLength(4000);
  });
});

describe('AddNoteModal — saving', () => {
  it('keeps the text and stays open when the note is refused', async () => {
    const onClose = vi.fn();
    render(<AddNoteModal onClose={onClose} onSave={async () => false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Una nota lunga e preziosa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi al dossier' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aggiungi al dossier' })).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Una nota lunga e preziosa');
  });
  it('closes once the note is saved, and names what it adds to', async () => {
    const onClose = vi.fn();
    render(<AddNoteModal onClose={onClose} onSave={async () => true} heading="Nota su art. 3" confirmLabel="Aggiungi all'articolo" />);
    expect(screen.getByRole('dialog', { name: 'Nota su art. 3' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: "Aggiungi all'articolo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
