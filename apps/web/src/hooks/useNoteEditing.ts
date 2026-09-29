import { useState } from 'react';
import type { Annotation } from '../types';

/**
 * Editing one note of a list in place — the Notes panel and the block
 * popover. Saving writes only a changed, non-empty text, trimmed; an empty
 * text or Esc leaves the note as it was.
 */
export function useNoteEditing(notes: readonly Annotation[], onUpdate: (id: string, text: string) => void) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const startEdit = (note: Annotation) => {
    setEditingId(note.id);
    setEditingText(note.text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };
  const commitEdit = () => {
    if (!editingId) return;
    const trimmed = editingText.trim();
    const original = notes.find((a) => a.id === editingId);
    if (original && trimmed && trimmed !== original.text) onUpdate(editingId, trimmed);
    cancelEdit();
  };

  return { editingId, editingText, setEditingText, startEdit, commitEdit, cancelEdit };
}
