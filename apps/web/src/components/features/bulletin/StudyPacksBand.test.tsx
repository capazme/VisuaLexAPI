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
  it('lays every pack out in one row of cards that scrolls sideways, under «Pronti da VisuaLex» (S7a)', () => {
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Pronti da VisuaLex' });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(STUDY_PACKS.length);
    expect(items[0].parentElement).toHaveClass('flex', 'overflow-x-auto', 'snap-x');
    expect(items[0]).toHaveClass('w-56', 'shrink-0', 'snap-start');
    // The row takes the focus itself, so the keyboard scrolls it past packs that hold no button.
    const row = screen.getByRole('list', { name: 'Pronti da VisuaLex' });
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAttribute('id', 'pronti');
    // No «Mostra tutti»: the row holds them all.
    expect(screen.queryByRole('button', { name: /^Mostra tutti/ })).toBeNull();
  });

  it('follows the category filter', () => {
    render(<StudyPacksBand category="penal" onAdded={vi.fn()} onError={vi.fn()} />);
    const shown = within(screen.getByRole('region')).getAllByRole('listitem').length;
    expect(shown).toBe(STUDY_PACKS.filter((p) => p.category === 'penal').length);
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
