import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    getAll: vi.fn(async () => []), getById: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 'srv-new', name: 'Nuova pratica', items: [], created_at: '2026-08-25T00:00:00Z', updated_at: '2026-08-25T00:00:00Z' })),
    update: vi.fn(async () => ({})), delete: vi.fn(async () => {}),
    addItem: vi.fn(async () => ({ id: 'item-srv' })),
    updateItem: vi.fn(async () => ({})), deleteItem: vi.fn(async () => {}),
    reorderItems: vi.fn(async () => {}),
  },
}));

// NOTE: `useAppStore` (used by the component itself) is a React-hook wrapper
// around the vanilla zustand store — it has no `getState`/`setState` of its
// own. Direct state setup/assertions in this test go through the separately
// exported vanilla store instance `appStore`, mirroring the established
// pattern in `src/store/dossierActions.test.ts`.
import { appStore } from '../../../store/useAppStore';
import { AddToDossierPopover } from './AddToDossierPopover';
import type { NormaVisitata } from '../../../types';

const norma: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043',
};

beforeEach(() => {
  appStore.setState({
    dossiers: [
      { id: 'old', title: 'Pratica vecchia', createdAt: '2026-01-01T00:00:00Z', items: [] },
      { id: 'recent', title: 'Pratica recente', createdAt: '2026-08-01T00:00:00Z', items: [
        { id: 'x', type: 'norma', data: { ...norma, numero_articolo: '2059' }, addedAt: '2026-08-20T00:00:00Z' },
      ] },
      { id: 'dup', title: 'Con duplicato', createdAt: '2026-05-01T00:00:00Z', items: [
        { id: 'y', type: 'norma', data: { ...norma }, addedAt: '2026-05-02T00:00:00Z' },
      ] },
    ],
  });
});

function renderPopover(onAdded = vi.fn(), onDuplicate?: (title: string) => void) {
  render(
    <AddToDossierPopover isOpen anchorEl={document.body} onClose={() => {}} norma={norma} onAdded={onAdded} onDuplicate={onDuplicate} />,
  );
  return onAdded;
}

describe('AddToDossierPopover', () => {
  it('lists dossiers most-recent first', () => {
    renderPopover();
    const options = screen.getAllByRole('button', { name: /pratica|duplicato/i }).map(b => b.textContent);
    expect(options[0]).toContain('Pratica recente');
  });
  it('adds to a dossier and reports through onAdded', () => {
    const onAdded = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: /pratica recente/i }));
    expect(appStore.getState().dossiers.find(d => d.id === 'recent')!.items).toHaveLength(2);
    expect(onAdded).toHaveBeenCalledWith('recent', 'Pratica recente');
  });
  it('marks and inhibits dossiers that already contain the article', () => {
    const onAdded = renderPopover();
    const dupRow = screen.getByRole('button', { name: /con duplicato/i });
    expect(dupRow).toHaveTextContent(/già presente/i);
    fireEvent.click(dupRow);
    expect(appStore.getState().dossiers.find(d => d.id === 'dup')!.items).toHaveLength(1);
    expect(onAdded).not.toHaveBeenCalled();
  });
  it('fires onDuplicate and keeps the popover open on a duplicate pick', () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const onDuplicate = vi.fn();
    render(
      <AddToDossierPopover isOpen anchorEl={document.body} onClose={onClose} norma={norma} onAdded={onAdded} onDuplicate={onDuplicate} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /con duplicato/i }));
    expect(onDuplicate).toHaveBeenCalledWith('Con duplicato');
    expect(onClose).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    expect(appStore.getState().dossiers.find(d => d.id === 'dup')!.items).toHaveLength(1);
  });
  it('creates a dossier inline with the server id, then adds', async () => {
    const onAdded = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: /nuovo dossier/i }));
    fireEvent.change(screen.getByPlaceholderText(/nome del dossier/i), { target: { value: 'Nuova pratica' } });
    fireEvent.submit(screen.getByRole('form', { name: /crea dossier/i }));
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith('srv-new', 'Nuova pratica'));
    const created = appStore.getState().dossiers.find(d => d.id === 'srv-new')!;
    expect(created.items).toHaveLength(1);
  });
});
