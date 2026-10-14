import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Dossier } from '../../../types';
import { appStore } from '../../../store/useAppStore';
import { DossierForumActions } from './DossierForumActions';

const service = vi.hoisted(() => ({ withdraw: vi.fn(), republish: vi.fn(), delete: vi.fn(), publish: vi.fn(), updateWithVersion: vi.fn(), getById: vi.fn() }));
vi.mock('../../../services/sharedEnvironmentService', () => ({ sharedEnvironmentService: service }));
vi.mock('./dossierPdfMarks', () => ({ loadPdfMarks: vi.fn().mockResolvedValue(new Map()) }));

const base: Dossier = {
  id: 'd', title: 'GDPR', createdAt: '2026-10-01', kind: 'studio',
  items: [{ id: 'n', type: 'norma', addedAt: '', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } } as Dossier['items'][number]],
};
const published = (isActive: boolean) => ({ sharedEnvironmentId: 'e1', version: 3, isActive, updatedAt: '' });

function show(d: Dossier) {
  const showToast = vi.fn();
  const refreshDossier = vi.fn().mockResolvedValue(undefined);
  appStore.setState({ dossiers: [d], refreshDossier });
  render(<MemoryRouter><DossierForumActions dossier={d} showToast={showToast} buttonClassName="btn" /></MemoryRouter>);
  return { showToast, refreshDossier };
}

beforeEach(() => Object.values(service).forEach((f) => f.mockReset().mockResolvedValue({})));

describe('DossierForumActions', () => {
  it('offers «Pubblica nel Forum» for a dossier never published, and opens the dialog', async () => {
    show(base);
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica nel Forum' }));
    expect(await screen.findByRole('dialog', { name: 'Pubblica nel Forum' })).toBeInTheDocument();
  });

  it('cannot publish a dossier the admin withdrew from the Forum (question 190)', () => {
    show({ ...base, forumBlocked: true });
    expect(screen.getByRole('button', { name: 'Ritirato dal Forum' })).toBeDisabled();
  });

  it('says the state of the copy and withdraws it, reading the dossier again', async () => {
    const { showToast, refreshDossier } = show({ ...base, published: published(true) });
    fireEvent.click(screen.getByRole('button', { name: 'Forum: Nel Forum · v3' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ritira dal Forum' }));
    await waitFor(() => expect(service.withdraw).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(refreshDossier).toHaveBeenCalledWith('d'));
    expect(showToast).toHaveBeenCalledWith('Dossier ritirato dal Forum', 'success');
  });

  it('republishes a copy its author withdrew, never one the admin withdrew', () => {
    show({ ...base, published: published(false), forumBlocked: true });
    fireEvent.click(screen.getByRole('button', { name: "Forum: Ritirato dall'amministrazione" }));
    expect(screen.getByRole('menuitem', { name: 'Ripubblica nel Forum' })).toBeDisabled();
  });

  it('deletes the copy only after a danger confirmation', async () => {
    show({ ...base, published: published(true) });
    fireEvent.click(screen.getByRole('button', { name: 'Forum: Nel Forum · v3' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina dal Forum' }));
    expect(service.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina dal Forum' }));
    await waitFor(() => expect(service.delete).toHaveBeenCalledWith('e1'));
  });
});
