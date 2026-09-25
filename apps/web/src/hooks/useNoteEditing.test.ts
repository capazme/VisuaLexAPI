import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNoteEditing } from './useNoteEditing';
import type { Annotation } from '../types';

const n: Annotation = { id: 'n1', normaKey: 'k', articleId: '1', text: 'prima', createdAt: '2026-09-25' };

describe('useNoteEditing', () => {
  it('saves a changed text, trimmed, and closes the editor', () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useNoteEditing([n], onUpdate));
    act(() => result.current.startEdit(n));
    expect(result.current).toMatchObject({ editingId: 'n1', editingText: 'prima' });
    act(() => result.current.setEditingText('  dopo  '));
    act(() => result.current.commitEdit());
    expect(onUpdate).toHaveBeenCalledWith('n1', 'dopo');
    expect(result.current.editingId).toBeNull();
  });

  it('saves nothing for an unchanged or empty text, or on cancel', () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useNoteEditing([n], onUpdate));
    for (const text of ['prima', '   ']) {
      act(() => result.current.startEdit(n));
      act(() => result.current.setEditingText(text));
      act(() => result.current.commitEdit());
    }
    act(() => result.current.startEdit(n));
    act(() => result.current.setEditingText('altro'));
    act(() => result.current.cancelEdit());
    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ editingId: null, editingText: '' });
  });
});
