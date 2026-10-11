import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrashPage } from './TrashPage';
import type { TrashEntry } from '../../../services/trashService';

const trash = (entries: TrashEntry[] | null, error: string | null = null) => ({
  entries, error, reload: vi.fn(), restore: vi.fn(), purge: vi.fn(),
});
const entry: TrashEntry = {
  id: 't3', kind: 'DOSSIER', dossierId: 'd9', label: 'Vecchia pratica', itemCount: 2,
  clientName: 'Claude Code', byApplication: true, deletedAt: '2026-10-04T10:00:00Z', expiresAt: '2026-11-03T10:00:00Z',
};

describe('TrashPage', () => {
  it('says the trash is empty, and what it is for', () => {
    render(<TrashPage trash={trash([])} onBack={() => {}} showToast={() => {}} />);
    expect(screen.getByText('Il cestino è vuoto')).toBeInTheDocument();
    expect(screen.getByText(/resta qui 30 giorni/)).toBeInTheDocument();
  });
  it('says the study cards the user deletes pass through it, and the rest does not', () => {
    render(<TrashPage trash={trash([])} onBack={() => {}} showToast={() => {}} />);
    const note = screen.getByText(/resta qui 30 giorni/);
    expect(note).toHaveTextContent('come le schede di studio che elimini tu');
    expect(note).toHaveTextContent('Il resto di ciò che elimini nell’app si può annullare subito e non passa di qui');
    expect(screen.getByText(/nessuna scheda di studio eliminata da te/)).toBeInTheDocument();
  });
  it('lists every entry', () => {
    render(<TrashPage trash={trash([entry])} onBack={() => {}} showToast={() => {}} />);
    expect(screen.getByText('Dossier «Vecchia pratica»')).toBeInTheDocument();
  });
  it('says when the trash is out of reach', () => {
    render(<TrashPage trash={trash(null, 'Il cestino non è raggiungibile in questo momento.')} onBack={() => {}} showToast={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('non è raggiungibile');
  });
});
