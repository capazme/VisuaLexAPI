import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
