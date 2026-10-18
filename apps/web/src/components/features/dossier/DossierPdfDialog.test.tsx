import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DossierPdfDialog } from './DossierPdfDialog';
import type { SentenzaItem } from './dossierLayout';

const decision = (id: string, numero: number): SentenzaItem => ({
  id, type: 'sentenza', addedAt: '',
  data: { corte: 'corte_costituzionale', numero, anno: 2014, etichetta: `Corte cost., n. ${numero}/2014` },
});
const DECISIONS = [decision('s1', 1), decision('s2', 2), decision('s3', 3)];

function setup(props: Partial<React.ComponentProps<typeof DossierPdfDialog>> = {}) {
  const onExport = vi.fn();
  const onClose = vi.fn();
  render(<DossierPdfDialog isOpen onClose={onClose} decisions={DECISIONS} progress={null} onExport={onExport} {...props} />);
  return { onExport, onClose };
}

describe('DossierPdfDialog', () => {
  it('opens on the full text with every decision ticked, and exports exactly that', () => {
    const { onExport } = setup();
    expect(screen.getByRole('dialog', { name: 'Esporta in PDF' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Testo completo' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Solo le parti evidenziate e annotate' })).not.toBeChecked();
    const group = screen.getByRole('group', { name: 'Sentenze' });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual(['Corte cost., n. 1/2014', 'Corte cost., n. 2/2014', 'Corte cost., n. 3/2014']);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(onExport).toHaveBeenCalledWith({ excerpts: false, decisionIds: ['s1', 's2', 's3'] });
  });

  it('«Cosa stampare» switches to the marked passages, for the articles and the decisions alike', () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Solo le parti evidenziate e annotate' }));
    expect(screen.getByRole('radio', { name: 'Testo completo' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(onExport).toHaveBeenCalledWith({ excerpts: true, decisionIds: ['s1', 's2', 's3'] });
  });

  it('a decision is left out by un-ticking it; «Nessuna» and «Tutte» change them all', () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Corte cost., n. 2/2014' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(onExport).toHaveBeenLastCalledWith({ excerpts: false, decisionIds: ['s1', 's3'] });

    fireEvent.click(screen.getByRole('button', { name: 'Nessuna' }));
    expect(screen.getAllByRole('checkbox').some((b) => (b as HTMLInputElement).checked)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(onExport).toHaveBeenLastCalledWith({ excerpts: false, decisionIds: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Tutte' }));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(onExport).toHaveBeenLastCalledWith({ excerpts: false, decisionIds: ['s1', 's2', 's3'] });
  });

  it('has no «Sentenze» section when the dossier holds none', () => {
    const { onExport } = setup({ decisions: [] });
    expect(screen.queryByRole('group', { name: 'Sentenze' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tutte' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));
    expect(onExport).toHaveBeenCalledWith({ excerpts: false, decisionIds: [] });
  });

  it('while the PDF is made it says how far it is, and the button and the choices are off', () => {
    const { onClose } = setup({ progress: { done: 3, total: 7 } });
    expect(screen.getByRole('status')).toHaveTextContent('Preparo il PDF… 3 di 7');
    expect(screen.getByRole('button', { name: /Scarica PDF/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Testo completo' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says only «Preparo il PDF…» before the count is known', () => {
    setup({ progress: { done: 0, total: 0 } });
    expect(screen.getByRole('status').textContent).toBe('Preparo il PDF…');
  });

  it('«Annulla» and Esc close it when nothing is being made; the touch targets are 44 px on a phone', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /Scarica PDF/ }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('radio', { name: 'Testo completo' }).closest('label')?.className).toContain('min-h-[44px]');
  });

  it('draws nothing when closed', () => {
    setup({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
