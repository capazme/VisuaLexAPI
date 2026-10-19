import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import { STUDY_PACKS, packContent } from '../../../utils/studyPacks';
import { StudyPacksBand } from './StudyPacksBand';

const service = vi.hoisted(() => ({ importStudy: vi.fn() }));
vi.mock('../../../services/dossierService', () => ({ dossierService: service }));

beforeEach(() => {
  service.importStudy.mockReset().mockResolvedValue({ dossiers: [] });
  appStore.setState({ dossiers: [] });
});

describe('StudyPacksBand', () => {
  it('shows six packs, then all of them on request', () => {
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    const list = () => within(screen.getByRole('region', { name: 'Dossier di studio pronti' })).getAllByRole('listitem');
    expect(list()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: `Mostra tutti (${STUDY_PACKS.length})` }));
    expect(list()).toHaveLength(STUDY_PACKS.length);
  });

  it('follows the category filter', () => {
    render(<StudyPacksBand category="penal" onAdded={vi.fn()} onError={vi.fn()} />);
    const shown = within(screen.getByRole('region')).getAllByRole('listitem').length;
    expect(shown).toBe(Math.min(6, STUDY_PACKS.filter((p) => p.category === 'penal').length));
  });

  it('adds a pack as dossiers di studio, without notes or highlights', async () => {
    const onAdded = vi.fn();
    const pack = STUDY_PACKS[0];
    render(<StudyPacksBand category="all" onAdded={onAdded} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: `Aggiungi «${pack.name}» ai miei dossier` }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(service.importStudy).toHaveBeenCalledWith(packContent(pack), { addNotes: false, addHighlights: false });
  });

  it('says when the pack is already among the dossiers di studio', () => {
    const pack = STUDY_PACKS[0];
    appStore.setState({ dossiers: pack.dossiers.map((d) => ({ ...d, kind: 'studio' as const })) });
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole('button', { name: `Aggiungi «${pack.name}» ai miei dossier` })).not.toBeInTheDocument();
    expect(screen.getAllByText('Già tra i tuoi dossier')).toHaveLength(1);
  });
});
