import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SharedEnvironment, StudyImportReport } from '../../../types';
import { AddToMyDossiersDialog } from './AddToMyDossiersDialog';

const service = vi.hoisted(() => ({ addToMyDossiers: vi.fn() }));
const bus = vi.hoisted(() => ({ publishMerltEvent: vi.fn() }));
vi.mock('../../../services/sharedEnvironmentService', () => ({ sharedEnvironmentService: service }));
vi.mock('../../../features/merlt/merltEventBus', () => ({
  publishMerltEvent: bus.publishMerltEvent,
  MERLT_EVENT_TYPES: { forumDownload: 'forum_download' },
}));

const report: StudyImportReport = {
  dossiers: [{ id: 'new', name: 'GDPR', entries: 1 }],
  notes: { added: 0, skipped: 0 }, highlights: { added: 1, skipped: 0 },
  quickNorms: { added: 0, skipped: 0 }, aliases: { added: 0, skipped: 0 }, refused: 0,
};

const env = {
  id: 'e1', title: 'GDPR', category: 'compliance', tags: [], includeNotes: true, includeHighlights: true,
  user: { id: 'author', username: 'mario' }, isOwner: false,
  content: {
    dossiers: [{ id: 'd1', title: 'GDPR', createdAt: '', items: [{ id: 'a', type: 'norma', addedAt: '', data: {} }] }],
    quickNorms: [], annotations: [{ id: 'a1' }], highlights: [{ id: 'h1' }],
  },
} as unknown as SharedEnvironment;

beforeEach(() => {
  service.addToMyDossiers.mockReset().mockResolvedValue(report);
  bus.publishMerltEvent.mockReset();
});

describe('AddToMyDossiersDialog', () => {
  it('adds the dossiers with what stays ticked, then sends forum_download without the author', async () => {
    const onAdded = vi.fn();
    render(<AddToMyDossiersDialog sharedEnvironment={env} onClose={vi.fn()} onAdded={onAdded} />);
    expect(screen.getByText(/diventa un tuo dossier di studio/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Le note (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(report));
    expect(service.addToMyDossiers).toHaveBeenCalledWith('e1', { addNotes: false, addHighlights: true });
    expect(bus.publishMerltEvent).toHaveBeenCalledWith({ interaction_type: 'forum_download', metadata: { shared_env_id: 'e1' } });
  });

  it('says a refusal and sends no event', async () => {
    service.addToMyDossiers.mockRejectedValue(new Error('Troppe aggiunte: riprova tra un\'ora.'));
    render(<AddToMyDossiersDialog sharedEnvironment={env} onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Troppe aggiunte: riprova tra un'ora.");
    expect(bus.publishMerltEvent).not.toHaveBeenCalled();
  });
});
