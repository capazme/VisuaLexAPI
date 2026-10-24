import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import { loadStudyPacks, packContent, type StudyPack } from '../../../utils/studyPacks';
import { StudyPacksBand } from './StudyPacksBand';

const service = vi.hoisted(() => ({ importStudy: vi.fn() }));
// The packs' data that cannot be loaded (a chunk a deploy removed), when a test asks for it.
const load = vi.hoisted(() => ({ fail: false }));
vi.mock('../../../utils/studyPacks', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../utils/studyPacks')>();
  return { ...real, loadStudyPacks: () => (load.fail ? Promise.reject(new Error('offline')) : real.loadStudyPacks()) };
});
vi.mock('../../../services/dossierService', () => ({ dossierService: service }));

// The packs come with the band (`loadStudyPacks`): the same list the band shows.
let STUDY_PACKS: StudyPack[];
beforeEach(async () => {
  load.fail = false;
  STUDY_PACKS = await loadStudyPacks();
  service.importStudy.mockReset().mockResolvedValue({ dossiers: [] });
  appStore.setState({ dossiers: [] });
});

describe('StudyPacksBand', () => {
  it('lays every pack out in one row of cards that scrolls sideways, under «Pronti da VisuaLex» (S7a)', async () => {
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Pronti da VisuaLex' });
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

  it('follows the category filter', async () => {
    render(<StudyPacksBand category="penal" onAdded={vi.fn()} onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Pronti da VisuaLex' });
    const shown = within(screen.getByRole('region')).getAllByRole('listitem').length;
    expect(shown).toBe(STUDY_PACKS.filter((p) => p.category === 'penal').length);
  });

  it('adds a pack as dossiers di studio, without notes or highlights', async () => {
    const onAdded = vi.fn();
    const pack = STUDY_PACKS[0];
    render(<StudyPacksBand category="all" onAdded={onAdded} onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Pronti da VisuaLex' });
    fireEvent.click(screen.getByRole('button', { name: `Aggiungi «${pack.name}» ai miei dossier` }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(service.importStudy).toHaveBeenCalledWith(packContent(pack), { addNotes: false, addHighlights: false });
  });

  it('says when the pack is already among the dossiers di studio', async () => {
    const pack = STUDY_PACKS[0];
    appStore.setState({ dossiers: pack.dossiers.map((d) => ({ ...d, kind: 'studio' as const })) });
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Pronti da VisuaLex' });
    expect(screen.queryByRole('button', { name: `Aggiungi «${pack.name}» ai miei dossier` })).not.toBeInTheDocument();
    expect(screen.getAllByText('Già tra i tuoi dossier')).toHaveLength(1);
  });

  it('while the packs load, keeps their place: the heading and cards of their size, then the packs', async () => {
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Pronti da VisuaLex' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(await screen.findByRole('list', { name: 'Pronti da VisuaLex' })).toBeInTheDocument();
  });

  it('leaves the band out when the packs cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    load.fail = true;
    const { container } = render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
