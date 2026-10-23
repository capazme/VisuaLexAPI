import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { ForumExploreView } from './ForumExploreView';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { SharedEnvironment } from '../../../types';

vi.mock('../../../services/sharedEnvironmentService', () => ({
  sharedEnvironmentService: { list: vi.fn() },
}));

const listMock = vi.mocked(sharedEnvironmentService.list);

function makeEnv(id: string, title: string, downloadCount: number): SharedEnvironment {
  return {
    id,
    title,
    description: '',
    content: { dossiers: [], quickNorms: [], customAliases: [], annotations: [], highlights: [] },
    category: 'civil',
    tags: [],
    includeNotes: false,
    includeHighlights: false,
    viewCount: 0,
    downloadCount,
    likeCount: 0,
    currentVersion: 1,
    isActive: true,
    user: { id: 'u1', username: 'mario' },
    userLiked: false,
    isOwner: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const noop = () => {};

/** The view inside a scroller of the test's, as the layout's content area holds it. */
function ForumExploreViewIn({ into }: { into: HTMLElement }) {
  return createPortal(
    <ForumExploreView
      environments={[]}
      pagination={{ page: 1, pages: 1, total: 0 }}
      loading={false}
      likingIds={new Set()}
      searchQuery=""
      setSearchQuery={noop}
      category="all"
      setCategory={noop}
      sort="newest"
      setSort={noop}
      showCategoryDropdown={false}
      setShowCategoryDropdown={noop}
      showSortDropdown={false}
      setShowSortDropdown={noop}
      onSearchSubmit={(e) => e.preventDefault()}
      onRefresh={noop}
      onPaginate={noop}
      onLike={noop}
      onImport={noop}
      onReport={noop}
      onSuggest={noop}
      onPublishClick={noop}
      onPacksAdded={noop}
      onPacksError={noop}
      onResetFilters={noop}
    />,
    into,
  );
}

function renderView(overrides: Partial<React.ComponentProps<typeof ForumExploreView>> = {}) {
  return render(
    <ForumExploreView
      environments={[]}
      pagination={{ page: 1, pages: 1, total: 0 }}
      loading={false}
      likingIds={new Set()}
      searchQuery=""
      setSearchQuery={noop}
      category="all"
      setCategory={noop}
      sort="newest"
      setSort={noop}
      showCategoryDropdown={false}
      setShowCategoryDropdown={noop}
      showSortDropdown={false}
      setShowSortDropdown={noop}
      onSearchSubmit={(e) => e.preventDefault()}
      onRefresh={noop}
      onPaginate={noop}
      onLike={noop}
      onImport={noop}
      onReport={noop}
      onSuggest={noop}
      onPublishClick={noop}
      onPacksAdded={noop}
      onPacksError={noop}
      onResetFilters={noop}
      {...overrides}
    />
  );
}

describe('ForumExploreView - «I più aggiunti» widget', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('requests the 3 most-downloaded environments and lists them', async () => {
    listMock.mockResolvedValue({
      data: [
        makeEnv('e1', 'Compliance Privacy', 42),
        makeEnv('e2', 'Diritto Civile', 30),
        makeEnv('e3', 'Penale Base', 11),
      ],
      pagination: { page: 1, limit: 3, total: 3, pages: 1 },
    });

    renderView();

    expect(listMock).toHaveBeenCalledWith({ sort: 'mostDownloaded', limit: 3 });

    await waitFor(() => {
      expect(screen.getByText('I più aggiunti')).toBeInTheDocument();
    });
    expect(screen.getByText('Compliance Privacy')).toBeInTheDocument();
    expect(screen.getByText('Diritto Civile')).toBeInTheDocument();
    expect(screen.getByText('Penale Base')).toBeInTheDocument();
    // Each row is a 44 px target on a phone.
    expect(screen.getByText('Compliance Privacy').closest('button')).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });

  it('hides the widget when no environment has downloads', async () => {
    listMock.mockResolvedValue({
      data: [makeEnv('e1', 'Nuovo Ambiente', 0)],
      pagination: { page: 1, limit: 3, total: 1, pages: 1 },
    });

    renderView();

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText('I più aggiunti')).not.toBeInTheDocument();
    });
  });
});

// 44 px on a phone, the design's own size from `md` (spec 2026-10-18-redesign-inchiostro, §7).
describe('ForumExploreView - touch targets on a phone', () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ data: [], pagination: { page: 1, limit: 3, total: 0, pages: 0 } });
  });

  it('gives the icon-only refresh button a name and 44 × 44 px', () => {
    renderView();
    expect(screen.getByRole('button', { name: "Aggiorna l'elenco" })).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'md:min-h-0', 'md:min-w-0');
  });

  it('gives «Pubblica un dossier» of the empty Forum 44 px', () => {
    renderView();
    expect(screen.getByRole('button', { name: 'Pubblica un dossier' })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });

  it('gives «Azzera filtri» of an empty search 44 px', () => {
    renderView({ searchQuery: 'privacy' });
    expect(screen.getByRole('button', { name: 'Azzera filtri' })).toHaveClass('min-h-[44px]', 'md:min-h-0');
  });
});

// One row of filters on a phone (M1): the search across, then the category and the order half each, the refresh beside.
describe('ForumExploreView - the filters on a phone', () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ data: [], pagination: { page: 1, limit: 3, total: 0, pages: 0 } });
  });

  it('puts the search on a row of its own and the category, the order and the refresh side by side under it', () => {
    renderView();
    const row = document.getElementById('tour-forum-filters')!;
    expect(row).toHaveClass('flex-wrap', 'sm:flex-nowrap');
    expect(screen.getByRole('textbox', { name: 'Cerca nei dossier pubblici' }).closest('form')).toHaveClass('basis-full', 'sm:basis-auto');
    for (const name of [/^Categoria:/, /^Ordine:/]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('w-full', 'min-h-[44px]');
      expect(button.parentElement).toHaveClass('flex-1', 'sm:flex-none');
    }
  });

  it('names the menus with what they hold, and writes «Tutte» on a phone where «Tutte le categorie» does not fit', () => {
    renderView();
    const category = screen.getByRole('button', { name: 'Categoria: Tutte le categorie' });
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(within(category).getByText('Tutte')).toHaveClass('sm:hidden');
    expect(within(category).getByText('Tutte le categorie')).toHaveClass('hidden', 'sm:inline');
    expect(screen.getByRole('button', { name: /^Ordine: / })).toHaveAttribute('aria-expanded', 'false');
  });

  it('writes the order in one word on a phone, where half a 320 px row cut «Più rece…», its name in full', () => {
    renderView();
    const order = screen.getByRole('button', { name: 'Ordine: Più recenti' });
    expect(within(order).getByText('Recenti')).toHaveClass('sm:hidden');
    expect(within(order).getByText('Più recenti')).toHaveClass('hidden', 'sm:inline');
  });
});

// The community's dossiers first, the Forum's reason; VisuaLex's packs after them (S7a).
describe('ForumExploreView - the order of the page', () => {
  const original = window.matchMedia;
  const setDesktop = (matches: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };
  const five = ['a', 'b', 'c', 'd', 'e'].map((id) => makeEnv(id, `Dossier ${id}`, 0));
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ data: [], pagination: { page: 1, limit: 3, total: 0, pages: 0 } });
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it('puts the community\'s grid first on a computer, three columns from xl, and «Pronti da VisuaLex» after it', () => {
    setDesktop(true);
    renderView({ environments: five, pagination: { page: 1, pages: 1, total: 5 } });
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(5);
    expect(cards[0].parentElement).toHaveClass('grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3');
    // One grid: every card, the same height in its row.
    expect(new Set(cards.map((card) => card.parentElement)).size).toBe(1);
    expect(cards[0]).toHaveClass('h-full', 'flex-col');
    const packs = screen.getByRole('region', { name: 'Pronti da VisuaLex' });
    expect(follows(cards[4], packs)).toBe(true);
  });

  it('brings the packs in after the first two of the community\'s dossiers on a phone', () => {
    setDesktop(false);
    renderView({ environments: five, pagination: { page: 1, pages: 1, total: 5 } });
    const cards = screen.getAllByRole('article');
    const packs = screen.getByRole('region', { name: 'Pronti da VisuaLex' });
    expect(follows(cards[1], packs)).toBe(true);
    expect(follows(packs, cards[2])).toBe(true);
    expect(screen.getAllByRole('region', { name: 'Pronti da VisuaLex' })).toHaveLength(1);
    // The tour's first card is still the first.
    expect(cards[0]).toHaveAttribute('id', 'tour-forum-card');
  });

  it('keeps the strip in its place on a phone while a new read travels: never mounted again', () => {
    setDesktop(false);
    const { rerender } = renderView({ environments: five, pagination: { page: 1, pages: 1, total: 5 } });
    const packs = screen.getByRole('region', { name: 'Pronti da VisuaLex' });
    const props = (loading: boolean) => ({
      environments: five, pagination: { page: 1, pages: 1, total: 5 }, loading, likingIds: new Set<string>(), searchQuery: '',
      setSearchQuery: noop, category: 'all' as const, setCategory: noop, sort: 'newest' as const, setSort: noop,
      showCategoryDropdown: false, setShowCategoryDropdown: noop, showSortDropdown: false, setShowSortDropdown: noop,
      onSearchSubmit: (e: React.FormEvent) => e.preventDefault(), onRefresh: noop, onPaginate: noop, onLike: noop,
      onImport: noop, onReport: noop, onSuggest: noop, onPublishClick: noop, onPacksAdded: noop, onPacksError: noop,
      onResetFilters: noop,
    });
    rerender(<ForumExploreView {...props(true)} />);
    expect(screen.getByRole('region', { name: 'Pronti da VisuaLex' })).toBe(packs);
    rerender(<ForumExploreView {...props(false)} />);
    expect(screen.getByRole('region', { name: 'Pronti da VisuaLex' })).toBe(packs);
  });

  // P1: the count's line came with the read and moved the cards down 44 px (CLS 0.12 on a phone), and the cards held in
  // place were shorter than those that came (0.04 at 1920).
  it('keeps the count\'s line, empty, and cards of the final height while the read travels, so nothing moves when it comes', () => {
    setDesktop(true);
    const { container, unmount } = renderView({ loading: true, environments: [], pagination: { page: 1, pages: 1, total: 0 } });
    const held = container.querySelector('p[aria-hidden]');
    expect(held).toHaveClass('h-5');
    expect(held).toHaveTextContent('');
    expect(screen.queryByText(/dossier pubblicat/)).toBeNull();
    const placeholder = container.querySelector('.motion-safe\\:animate-pulse');
    expect(placeholder).toHaveClass('min-h-[16.75rem]', 'md:min-h-[15.25rem]');
    unmount();
    const loaded = renderView({ environments: five, pagination: { page: 1, pages: 1, total: 5 } });
    expect(screen.getByText('5 dossier pubblicati')).toHaveClass('text-sm');
    expect(loaded.container.querySelector('p[aria-hidden].h-5')).toBeNull();
  });

  it('heads the community\'s dossiers, for a screen reader, and «I più aggiunti» at the same level as the packs', async () => {
    setDesktop(false);
    listMock.mockResolvedValue({ data: [makeEnv('t1', 'Uno', 4)], pagination: { page: 1, limit: 3, total: 1, pages: 1 } });
    renderView({ environments: five, pagination: { page: 1, pages: 1, total: 5 } });
    expect(screen.getByRole('heading', { level: 2, name: 'Dalla comunità' })).toHaveClass('sr-only');
    // The cards after the strip are not read as its part.
    const more = screen.getByRole('heading', { level: 2, name: 'Altri dossier della comunità' });
    const packs = screen.getByRole('region', { name: 'Pronti da VisuaLex' });
    expect(follows(packs, more) && follows(more, screen.getAllByRole('article')[2])).toBe(true);
    expect(await screen.findByRole('heading', { level: 2, name: 'I più aggiunti' })).toBeInTheDocument();
  });

  it('brings «Pronti da VisuaLex» to the top of the content and focuses it, from /forum#pronti', () => {
    setDesktop(true);
    window.history.replaceState(null, '', '/forum#pronti');
    const scrollTo = vi.fn();
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    document.body.append(scroller);
    try {
      const { unmount } = render(<ForumExploreViewIn into={scroller} />);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(document.getElementById('pronti'));
      // The fragment leaves the address after the jump, the rest of it kept.
      expect(window.location.hash).toBe('');
      expect(window.location.pathname).toBe('/forum');
      // Explore drawn again (another tab and back, a reload): no second jump, no focus taken.
      unmount();
      (document.activeElement as HTMLElement | null)?.blur();
      render(<ForumExploreViewIn into={scroller} />);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(document.activeElement).not.toBe(document.getElementById('pronti'));
    } finally {
      scroller.remove();
      window.history.replaceState(null, '', '/');
    }
  });

  it('shows the packs once, after the empty Forum', () => {
    setDesktop(true);
    renderView();
    const empty = screen.getByText('Ancora nessun dossier nel Forum');
    const packs = screen.getByRole('region', { name: 'Pronti da VisuaLex' });
    expect(follows(empty, packs)).toBe(true);
  });
});
