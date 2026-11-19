import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const onPublish = vi.fn();
  render(<MemoryRouter><DossierForumActions dossier={d} showToast={showToast} buttonClassName="btn" onPublish={onPublish} /></MemoryRouter>);
  return { showToast, refreshDossier, onPublish };
}

beforeEach(() => Object.values(service).forEach((f) => f.mockReset().mockResolvedValue({})));

describe('DossierForumActions', () => {
  it('offers «Pubblica nel Forum» for a dossier never published, and asks the page to open the form (LC125)', () => {
    const { onPublish } = show(base);
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica nel Forum' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Aggiorna la versione pubblicata» asks the page for the same form', () => {
    const { onPublish } = show({ ...base, published: published(true) });
    fireEvent.click(screen.getByRole('button', { name: 'Forum: Nel Forum · v3' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aggiorna la versione pubblicata' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('cannot publish a dossier the admin withdrew from the Forum (question 190)', () => {
    show({ ...base, forumBlocked: true });
    expect(screen.getByRole('button', { name: 'Ritirato dai dossier pubblici' })).toBeDisabled();
  });

  it('says the state of the copy and withdraws it, reading the dossier again', async () => {
    const { showToast, refreshDossier } = show({ ...base, published: published(true) });
    fireEvent.click(screen.getByRole('button', { name: 'Forum: Nel Forum · v3' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ritira dai dossier pubblici' }));
    await waitFor(() => expect(service.withdraw).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(refreshDossier).toHaveBeenCalledWith('d'));
    expect(showToast).toHaveBeenCalledWith('Copia pubblicata ritirata', 'success');
  });

  it('republishes a copy its author withdrew, never one the admin withdrew', () => {
    show({ ...base, published: published(false), forumBlocked: true });
    fireEvent.click(screen.getByRole('button', { name: "Forum: Ritirato dall'amministrazione" }));
    expect(screen.getByRole('menuitem', { name: 'Ripubblica nel Forum' })).toBeDisabled();
  });

  it('deletes the copy only after a danger confirmation', async () => {
    show({ ...base, published: published(true) });
    fireEvent.click(screen.getByRole('button', { name: 'Forum: Nel Forum · v3' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina dai dossier pubblici' }));
    expect(service.delete).not.toHaveBeenCalled();
    // Its buttons answer once they have risen into sight (K1b).
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveAttribute('data-ready'));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina dai dossier pubblici' }));
    await waitFor(() => expect(service.delete).toHaveBeenCalledWith('e1'));
  });
});

describe('DossierForumActions, a confirmation asked by a menu entry (LC85, Papiniano on #585)', () => {
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.restoreAllMocks();
  });

  it('grows out of the «Forum» button, the entry being gone, and gives that button the focus back', async () => {
    const runs: { el: Element; keyframes: Keyframe[] }[] = [];
    Object.defineProperty(Element.prototype, 'animate', {
      value: function (this: Element, keyframes: Keyframe[]) {
        runs.push({ el: this, keyframes });
        return { cancel: () => {}, onfinish: null, effect: { target: this } };
      },
      configurable: true,
      writable: true,
    });
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const own = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      // The «Forum» button 120 × 36 at 900,200; the card 384 × 196 in the middle (Papiniano's numbers).
      if (this.getAttribute('aria-label') === 'Forum: Nel Forum · v3') return rect(900, 200, 120, 36);
      if (this.getAttribute('role') === 'alertdialog') return rect(528, 350, 384, 196);
      return own.call(this);
    });
    show({ ...base, published: published(true) });
    const forum = screen.getByRole('button', { name: 'Forum: Nel Forum · v3' });
    fireEvent.click(forum);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina dai dossier pubblici' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Eliminare la copia pubblicata?' });
    const shape = dialog.querySelector('[data-island-shape]')!;
    expect(runs.find((run) => run.el === shape)?.keyframes[0]).toMatchObject({ top: '-150px', left: '372px', right: '-108px', bottom: '310px' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(forum).toHaveFocus());
    expect(service.delete).not.toHaveBeenCalled();
  });
});
