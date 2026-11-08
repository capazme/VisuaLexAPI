import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import { loadStudyPacks, packContent, type StudyPack } from '../../../utils/studyPacks';
import { StudyPacksBand } from './StudyPacksBand';
import { CARD_GRID_COLUMNS } from '../../layout/frame';

const service = vi.hoisted(() => ({ importStudy: vi.fn() }));
// The packs' data still on its way (`release` brings it) or that cannot be loaded (a chunk a deploy removed), when a
// test asks for it; otherwise loaded, as after a first visit.
const load = vi.hoisted(() => ({ fail: false, held: false, release: () => {} }));
vi.mock('../../../utils/studyPacks', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../utils/studyPacks')>();
  return {
    ...real,
    peekStudyPacks: () => (load.fail || load.held ? undefined : real.peekStudyPacks()),
    loadStudyPacks: () => {
      if (load.fail) return Promise.reject(new Error('offline'));
      if (load.held) return new Promise((resolve) => { load.release = () => resolve(real.loadStudyPacks()); });
      return real.loadStudyPacks();
    },
  };
});
vi.mock('../../../services/dossierService', () => ({ dossierService: service }));

// The packs come with the band (`loadStudyPacks`): the same list the band shows.
let STUDY_PACKS: StudyPack[];
beforeEach(async () => {
  load.fail = false;
  load.held = false;
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

  it('is a grid of cards of at least 20rem from three of them, by its own width, the row below (U1)', async () => {
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Pronti da VisuaLex' });
    // The band's own width decides (the sidebar and the full screen count), not the window's.
    expect(screen.getByRole('region', { name: 'Pronti da VisuaLex' })).toHaveClass('@container');
    expect(list).toHaveClass('@min-[61.5rem]:grid', CARD_GRID_COLUMNS, '@min-[61.5rem]:overflow-x-visible');
    expect(within(list).getAllByRole('listitem')[0]).toHaveClass('@min-[61.5rem]:w-auto');
  });

  it('as a grid, which scrolls nothing, is no Tab stop of its own, still focusable for /forum#pronti (U1)', async () => {
    // The browser's layout, which jsdom has not: the list laid out as `display` says, and the observer reporting a
    // resize whenever the test calls `resized`.
    let display = 'grid';
    const realStyle = window.getComputedStyle;
    const style = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const real = realStyle(element, pseudo);
      if ((element as HTMLElement).id !== 'pronti') return real;
      return new Proxy(real, {
        get: (target, key) => {
          if (key === 'display') return display;
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    let resized = () => {};
    const RealObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(report: ResizeObserverCallback) { resized = () => report([], this as unknown as ResizeObserver); }
      observe() { resized(); }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
      const list = await screen.findByRole('list', { name: 'Pronti da VisuaLex' });
      await waitFor(() => expect(list).toHaveAttribute('tabindex', '-1'));
      list.focus();
      expect(list).toHaveFocus();
      // Narrowed (the window, the sidebar widened, the full screen left): the row again, a Tab stop again.
      display = 'flex';
      act(() => resized());
      expect(list).toHaveAttribute('tabindex', '0');
      display = 'grid';
      act(() => resized());
      expect(list).toHaveAttribute('tabindex', '-1');
    } finally {
      window.ResizeObserver = RealObserver;
      style.mockRestore();
    }
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
    load.held = true;
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Pronti da VisuaLex' })).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Pronti da VisuaLex' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    // As many cards as the packs of «Tutte le categorie», laid out as they will be: the grid holds their height (U1).
    const held = region.querySelector('[aria-hidden="true"]')!;
    expect(held.children).toHaveLength(STUDY_PACKS.length);
    expect(held).toHaveClass('flex', '@min-[61.5rem]:grid', CARD_GRID_COLUMNS);
    expect(held.firstElementChild).toHaveClass('w-56', '@min-[61.5rem]:w-auto');
    // A name on two lines in the row, where the cards stretch to the tallest; on one in the grid, where the names fit.
    const nameLines = held.firstElementChild!.firstElementChild!.firstElementChild!.children;
    expect(nameLines).toHaveLength(2);
    expect(nameLines[0]).not.toHaveClass('@min-[61.5rem]:hidden');
    expect(nameLines[1]).toHaveClass('@min-[61.5rem]:hidden');
    load.release();
    expect(await screen.findByRole('list', { name: 'Pronti da VisuaLex' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pronti da VisuaLex' })).not.toHaveAttribute('aria-busy');
  });

  it('drawn again once they are loaded, shows the packs at once (back on the Forum)', () => {
    render(<StudyPacksBand category="all" onAdded={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Pronti da VisuaLex' })).toBeInTheDocument();
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
