import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteCard, type NoteCardProps } from './NoteCard';

const base = (over: Partial<NoteCardProps> = {}): NoteCardProps => ({
  note: { id: 'n1', normaKey: 'k', articleId: '1', text: 'Vedi Cass. 2020', createdAt: '2026-09-25', anchorText: 'contraenti', startOffset: 3 },
  isEditing: false, editingText: '',
  onStartEdit: vi.fn(), onChangeEdit: vi.fn(), onCommitEdit: vi.fn(), onCancelEdit: vi.fn(), onRemove: vi.fn(),
  ...over,
});

describe('NoteCard', () => {
  it('shows the anchor and the note; a click on the text starts editing', () => {
    const props = base();
    render(<NoteCard {...props} />);
    expect(screen.getByText(/contraenti/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vedi Cass. 2020' }));
    expect(props.onStartEdit).toHaveBeenCalled();
  });

  it('saves with Cmd+Enter and cancels with Escape', () => {
    const props = base({ isEditing: true, editingText: 'nuovo' });
    render(<NoteCard {...props} />);
    const box = screen.getByRole('textbox');
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(props.onCommitEdit).toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(props.onCancelEdit).toHaveBeenCalled();
  });

  it('deletes, and offers "Vai al passo" only when asked to', () => {
    const props = base();
    const { rerender } = render(<NoteCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina nota' }));
    expect(props.onRemove).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Vai al passo/ })).toBeNull();
    const onGoTo = vi.fn();
    rerender(<NoteCard {...props} onGoTo={onGoTo} />);
    fireEvent.click(screen.getByRole('button', { name: /Vai al passo/ }));
    expect(onGoTo).toHaveBeenCalled();
  });

  it('credits an imported note to its author', () => {
    const props = base();
    render(<NoteCard {...props} note={{ ...props.note, sourceSuggestionId: 's1', originalAuthor: { id: 'u', username: 'marta' } }} />);
    expect(screen.getByTitle('Suggerita da @marta')).toBeInTheDocument();
  });
});
