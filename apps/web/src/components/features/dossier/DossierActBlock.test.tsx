import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

vi.mock('./useActDetails', () => ({
  useActDetails: () => ({
    title: "Nuova disciplina dell'ordinamento della professione forense",
    rubricaOf: (norma: { numero_articolo: string }) => (norma.numero_articolo === '3' ? 'Doveri e deontologia' : null),
  }),
}));
vi.mock('./DossierItemReader', () => ({ DossierItemReader: () => null }));

import { DossierActBlock, type DossierActBlockProps } from './DossierActBlock';
import { layoutDossier } from './dossierLayout';
import type { DossierItem } from '../../../types';

const L247 = 'l. 31 dicembre 2012, n. 247';
const item = (numero_articolo: string, actCitation: string | null = L247): DossierItem => ({
  id: `i${numero_articolo}`, type: 'norma', addedAt: '', ...(actCitation ? { actCitation } : {}),
  data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo },
});

function renderBlock(items: DossierItem[], over: Partial<DossierActBlockProps> = {}) {
  const [block] = layoutDossier(items).acts;
  const props: DossierActBlockProps = {
    block, dragDisabled: false, isFolded: false, onToggleFold: vi.fn(),
    expandedIds: new Set(), onToggleExpand: vi.fn(), selectedIds: new Set(), showCheckbox: false,
    onToggleSelect: vi.fn(), onOpenAct: vi.fn(), onAddArticles: vi.fn(), onRemoveAct: vi.fn(),
    onOpenItem: vi.fn(), onRemoveItem: vi.fn(), onToggleImportant: vi.fn(), showToast: vi.fn(),
    ...over,
  };
  render(
    <DndContext>
      <SortableContext items={[block.key]} strategy={verticalListSortingStrategy}>
        <DossierActBlock {...props} />
      </SortableContext>
    </DndContext>,
  );
  return props;
}

describe('DossierActBlock', () => {
  it('names the act once, with its title and count, and its articles by number and rubrica', () => {
    renderBlock([item('3'), item('1')]);
    expect(screen.getAllByRole('heading', { name: L247 })).toHaveLength(1);
    expect(screen.getByText("Nuova disciplina dell'ordinamento della professione forense")).toBeInTheDocument();
    expect(screen.getByText('2 articoli')).toBeInTheDocument();
    expect(screen.getAllByText(/^art\. \d+$/).map((el) => el.textContent)).toEqual(['art. 1', 'art. 3']);
    expect(screen.getByText('Doveri e deontologia')).toBeInTheDocument();
  });

  it('heads an act the server has not named yet with the muted fallback', () => {
    renderBlock([item('3', null)]);
    const heading = screen.getByRole('heading', { name: 'legge n. 247' });
    expect(heading.className).toMatch(/text-slate-500/);
  });

  it('folds into the line of its numbers', () => {
    renderBlock([item('3'), item('1')], { isFolded: true });
    expect(screen.getByText('artt. 1, 3')).toBeInTheDocument();
    expect(screen.queryByText(/^art\. 1$/)).toBeNull();
    expect(screen.getByRole('button', { name: `Apri ${L247}` })).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles the fold from its heading', () => {
    const props = renderBlock([item('3')]);
    fireEvent.click(screen.getByRole('button', { name: `Chiudi ${L247}` }));
    expect(props.onToggleFold).toHaveBeenCalledTimes(1);
  });

  it('opens the act, adds articles, and removes the act from its menu', () => {
    const props = renderBlock([item('3')]);
    fireEvent.click(screen.getByRole('button', { name: `Apri tutto ${L247} su Dashboard` }));
    fireEvent.click(screen.getByRole('button', { name: `Aggiungi articoli di ${L247}` }));
    fireEvent.click(screen.getByRole('button', { name: `Azioni su ${L247}` }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Rimuovi l'atto dal dossier" }));
    expect(props.onOpenAct).toHaveBeenCalledTimes(1);
    expect(props.onAddArticles).toHaveBeenCalledTimes(1);
    expect(props.onRemoveAct).toHaveBeenCalledTimes(1);
  });

  it('has a drag handle named for the act, gone while dragging is off', () => {
    renderBlock([item('3')]);
    expect(screen.getByRole('button', { name: `Sposta ${L247}` })).toBeInTheDocument();
  });

  it('has no drag handle while the search filters the page', () => {
    renderBlock([item('3')], { dragDisabled: true });
    expect(screen.queryByRole('button', { name: `Sposta ${L247}` })).toBeNull();
  });
});
