import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
});
