import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DossierRecentlyRemoved } from './DossierRecentlyRemoved';
import type { TrashEntry } from '../../../services/trashService';

const entry: TrashEntry = {
  id: 't1', kind: 'DOSSIER_ITEMS', dossierId: 'd1', label: 'Ricorso Rossi', itemCount: 1,
  items: [{ itemType: 'note', citation: null, actCitation: null }],
  clientName: 'Claude Code', deletedAt: '2026-10-04T10:00:00Z', expiresAt: '2026-11-03T10:00:00Z',
};
const props = { dossiers: [], onRestore: vi.fn(), onPurge: vi.fn(), showToast: vi.fn() };

describe('DossierRecentlyRemoved', () => {
  it('is not drawn when nothing of the dossier is in the trash', () => {
    const { container } = render(<DossierRecentlyRemoved entries={[]} {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('opens on its entries', () => {
    render(<DossierRecentlyRemoved entries={[entry]} {...props} />);
    const toggle = screen.getByRole('button', { name: 'Rimossi di recente (1) — ripristina' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText('1 elemento')).toBeInTheDocument();
    expect(screen.getByText('1 nota')).toBeInTheDocument();
  });
});
