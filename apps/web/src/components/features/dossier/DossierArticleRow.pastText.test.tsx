import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableDossierItem } from './SortableDossierItem';
import type { DossierItem } from '../../../types';

const item = (data: Partial<Extract<DossierItem, { type: 'norma' }>['data']> = {}): DossierItem => ({
  id: 'i1', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z',
  data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', ...data },
});

function renderRow(row: DossierItem) {
  return render(
    <DndContext>
      <SortableContext items={[row.id]} strategy={verticalListSortingStrategy}>
        <SortableDossierItem
          item={row} isSelected={false} showCheckbox={false}
          onToggleSelect={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
          isExpanded={false} onToggleExpand={() => {}}
          onOpenOnDashboard={() => {}} showToast={() => {}}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('SortableDossierItem — a past text', () => {
  it('says which day an item that holds a past text was asked for', () => {
    renderRow(item({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(screen.getByText('Testo al 29/12/2007')).toBeInTheDocument();
  });

  it('names the version in the row\'s accessible name, so two versions of one article read differently', () => {
    renderRow(item({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(screen.getByLabelText(/^Espandi codice civile 262 articolo 1284, testo al 29\/12\/2007$/)).toBeInTheDocument();
  });

  it('leaves the accessible name of the text in force as it was', () => {
    renderRow(item({}));
    expect(screen.getByLabelText('Espandi codice civile 262 articolo 1284')).toBeInTheDocument();
  });

  it('says it holds the original text', () => {
    renderRow(item({ versione: 'originale' }));
    expect(screen.getByText('Testo originale')).toBeInTheDocument();
  });

  it.each([
    ['an item saved before versions were kept', {}],
    ['the text in force', { versione: 'vigente', data_versione: '' }],
  ])('says nothing on %s', (_name, data) => {
    renderRow(item(data));
    expect(screen.queryByText(/Testo al|Testo originale/)).not.toBeInTheDocument();
  });

  it('says nothing on a note', () => {
    renderRow({ id: 'n1', type: 'note', data: 'appunto', addedAt: '2026-08-01' });
    expect(screen.queryByText(/Testo al|Testo originale/)).not.toBeInTheDocument();
  });
});
