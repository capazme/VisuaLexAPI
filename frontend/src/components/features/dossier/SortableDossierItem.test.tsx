import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableDossierItem } from './SortableDossierItem';
import type { DossierItem } from '../../../types';

const normaItem: DossierItem = {
  id: 'i1', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z',
  data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' },
};

function renderRow(item: DossierItem, over: Partial<Parameters<typeof SortableDossierItem>[0]> = {}) {
  return render(
    <DndContext>
      <SortableContext items={[item.id]} strategy={verticalListSortingStrategy}>
        <SortableDossierItem
          item={item} isSelected={false} showCheckbox={false}
          onToggleSelect={() => {}} onRemove={() => {}}
          onToggleImportant={() => {}}
          isExpanded={false} onToggleExpand={() => {}}
          onOpenOnDashboard={() => {}} showToast={() => {}}
          {...over}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('SortableDossierItem star', () => {
  it('renders an unpressed star for a plain norma item and fires onToggleImportant', () => {
    const onToggleImportant = vi.fn();
    renderRow(normaItem, { onToggleImportant });
    const star = screen.getByRole('button', { name: /segna come importante/i });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(onToggleImportant).toHaveBeenCalledTimes(1);
  });
  it('renders a pressed star for an important item', () => {
    renderRow({ ...normaItem, status: 'important' });
    expect(screen.getByRole('button', { name: /rimuovi da importanti/i }))
      .toHaveAttribute('aria-pressed', 'true');
  });
  it('shows no status menu anymore', () => {
    renderRow(normaItem);
    expect(screen.queryByRole('button', { name: /cambia stato/i })).toBeNull();
  });
  it('hides the star on note items', () => {
    renderRow({ id: 'n1', type: 'note', data: 'appunto di pratica', addedAt: '2026-08-01' });
    expect(screen.queryByRole('button', { name: /importante/i })).toBeNull();
  });
});

describe('SortableDossierItem expansion', () => {
  it('expands a note item in place on row click', () => {
    const noteItem: DossierItem = { id: 'n1', type: 'note', data: 'appunto di pratica completo', addedAt: '2026-08-01' };
    const { rerender } = renderRow(noteItem);
    const row = screen.getByRole('button', { name: /espandi nota/i });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    // Parent owns the state, so re-render with it flipped to see the body.
    const onToggleExpand = vi.fn();
    rerender(
      <DndContext>
        <SortableContext items={[noteItem.id]} strategy={verticalListSortingStrategy}>
          <SortableDossierItem
            item={noteItem} isSelected={false} showCheckbox={false}
            onToggleSelect={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
            isExpanded={true} onToggleExpand={onToggleExpand}
            onOpenOnDashboard={() => {}} showToast={() => {}}
          />
        </SortableContext>
      </DndContext>,
    );
    expect(screen.getByText('appunto di pratica completo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /comprimi nota/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('fires onToggleExpand when the row is activated', () => {
    const onToggleExpand = vi.fn();
    renderRow(normaItem, { onToggleExpand });
    fireEvent.click(screen.getByRole('button', { name: /espandi codice civile/i }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });
});
