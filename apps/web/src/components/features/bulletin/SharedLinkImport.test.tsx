import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SharedLinkImport } from './SharedLinkImport';

const service = vi.hoisted(() => ({ importStudy: vi.fn() }));
vi.mock('../../../services/dossierService', () => ({ dossierService: service }));

const shared = {
  name: 'GDPR', dossiers: [{ id: 'd1', title: 'Basi giuridiche', createdAt: '', items: [{ id: 'i', type: 'norma', addedAt: '', data: {} }] }],
  quickNorms: [{ id: 'q' }], customAliases: [], annotations: [{ id: 'a1' }], highlights: [],
};
// As the old «Copia link» encoded it.
const encode = (value: unknown) => encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({ version: 1, type: 'environment', data: value })))));

function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}

function show(search: string, onRecovered = vi.fn()) {
  render(<MemoryRouter initialEntries={[`/forum${search}`]}><SharedLinkImport onRecovered={onRecovered} /><Where /></MemoryRouter>);
  return onRecovered;
}

beforeEach(() => service.importStudy.mockReset().mockResolvedValue({ dossiers: [{ id: 'n', name: 'Basi giuridiche', entries: 1 }] }));

describe('SharedLinkImport', () => {
  it('draws nothing without ?import=', () => {
    show('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('previews an old link and recovers its dossiers, never its quick norms, then clears the address', async () => {
    const onRecovered = show(`?import=${encode(shared)}`);
    expect(screen.getByRole('dialog', { name: 'Recupera i dossier' })).toHaveTextContent('Il link condiviso «GDPR» diventa un tuo dossier di studio.');
    fireEvent.click(screen.getByRole('button', { name: 'Recupera i dossier' }));
    await waitFor(() => expect(onRecovered).toHaveBeenCalled());
    expect(service.importStudy).toHaveBeenCalledWith(
      { dossiers: shared.dossiers, quickNorms: [], annotations: shared.annotations, highlights: [] },
      { addNotes: true, addHighlights: false },
    );
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/);
  });

  it('treats a link without a dossier that can be listed as unreadable', () => {
    show(`?import=${encode({ name: 'x', dossiers: [{}], quickNorms: [] })}`);
    expect(screen.getByRole('dialog', { name: 'Link non valido' })).toBeInTheDocument();
  });

  it('says when the link cannot be read', () => {
    show('?import=%%%');
    expect(screen.getByRole('dialog', { name: 'Link non valido' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Chiudi' }).at(-1)!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
