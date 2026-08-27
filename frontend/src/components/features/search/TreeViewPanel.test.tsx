import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The tour hook fires timers and writes to localStorage on mount; neither is
// what this test is about.
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { appStore } from '../../../store/useAppStore';
import { TreeViewPanel } from './TreeViewPanel';
import type { RubrichePart } from '../../../hooks/useAnnexNavigation';

const originalMatchMedia = window.matchMedia;

/** The shared setup shim answers `false` to every query; these tests need both. */
function setViewport(isDesktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  appStore.setState({
    structureWindow: { blockId: 'block-a', position: { x: 120, y: 80 } },
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('TreeViewPanel — window variant', () => {
  beforeEach(() => setViewport(true));

  it('renders the index outside its own subtree, on document.body', () => {
    const { container } = render(
      <TreeViewPanel
        variant="window"
        isOpen
        onClose={vi.fn()}
        treeData={['1', '2']}
        urn="urn:test"
        title="Struttura Atto"
      />,
    );

    // Portalled out: nothing lands in the component's own container, which is
    // the whole point — the workspace panel it lives under is transformed.
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByText('Struttura Atto')).toBeInTheDocument();
  });

  it('stays open after an article is picked', () => {
    const onArticleSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <TreeViewPanel
        variant="window"
        isOpen
        onClose={onClose}
        treeData={['1', '2']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(onArticleSelect).toHaveBeenCalledWith('1', null);
    // Picking must not dismiss the window: taking several articles out of one
    // index without reopening it is the point of the round.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
  });

  it('renders nothing on a small viewport, so the portal cannot leak onto mobile', () => {
    setViewport(false);

    render(
      <TreeViewPanel
        variant="window"
        isOpen
        onClose={vi.fn()}
        treeData={['1']}
        urn="urn:test"
        title="Struttura Atto"
      />,
    );

    expect(screen.queryByText('Struttura Atto')).not.toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    render(
      <TreeViewPanel
        variant="window"
        isOpen={false}
        onClose={vi.fn()}
        treeData={['1']}
        urn="urn:test"
        title="Struttura Atto"
      />,
    );

    expect(screen.queryByText('Struttura Atto')).not.toBeInTheDocument();
  });
});

describe('TreeViewPanel — drawer variant', () => {
  beforeEach(() => setViewport(false));

  it('renders in place rather than through a portal', () => {
    const { container } = render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1']}
        urn="urn:test"
        title="Struttura dell'Atto"
      />,
    );

    // Not portalled, so its `md:hidden` wrapper keeps it off desktop.
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText("Struttura dell'Atto")).toBeInTheDocument();
  });

  it('also stays open after a pick', () => {
    const onClose = vi.fn();
    const onArticleSelect = vi.fn();

    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={onClose}
        treeData={['1']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(onArticleSelect).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TreeViewPanel — rubriche', () => {
  beforeEach(() => setViewport(false));

  it('renders a rubrica beside its article number', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['2043', '2044']}
        urn="urn:test"
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    expect(
      screen.getByRole('button', { name: '2043 Risarcimento per fatto illecito' }),
    ).toBeInTheDocument();
    // Truncated to one line on screen, so the full text has to survive as a
    // tooltip.
    expect(
      screen.getByRole('button', { name: '2043 Risarcimento per fatto illecito' }),
    ).toHaveAttribute('title', 'Risarcimento per fatto illecito');
  });

  it('renders the bare number for an article the export has no rubrica for', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['2043', '2044']}
        urn="urn:test"
        // 89% coverage is the measured best case; the gap is the normal case,
        // not an error state.
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    // The covered sibling proves the map was honoured at all, so the bare row
    // is a real gap rather than rubriche having been ignored wholesale.
    expect(
      screen.getByRole('button', { name: '2043 Risarcimento per fatto illecito' }),
    ).toBeInTheDocument();

    const bare = screen.getByRole('button', { name: '2044' });
    expect(bare).toBeInTheDocument();
    expect(bare).not.toHaveAttribute('title');
  });

  it('survives an act with no rubriche at all (the Costituzione)', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1', '2']}
        urn="urn:test"
        rubriche={{}}
      />,
    );

    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    // Zero coverage costs nothing: the index is still the same surface.
    expect(
      screen.getByLabelText('Filtra gli articoli per numero o rubrica'),
    ).toBeInTheDocument();
  });

  it('still hands onArticleSelect the same argument when a rubrica is shown', () => {
    const onArticleSelect = vi.fn();

    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['2043']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: '2043 Risarcimento per fatto illecito' }),
    );

    expect(onArticleSelect).toHaveBeenCalledWith('2043', null);
  });
});

describe('TreeViewPanel — filter', () => {
  beforeEach(() => setViewport(false));

  const filterInput = () =>
    screen.getByLabelText('Filtra gli articoli per numero o rubrica');

  it('matches by article-number prefix', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1', '12', '120', '2043']}
        urn="urn:test"
      />,
    );

    fireEvent.change(filterInput(), { target: { value: '12' } });

    expect(screen.getByRole('button', { name: '12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '120' })).toBeInTheDocument();
    // Prefix, not substring: 2043 does not contain a leading "12" either way.
    expect(screen.queryByRole('button', { name: '2043' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument();
  });

  it('matches by rubrica substring, ignoring accents', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1218', '2043']}
        urn="urn:test"
        rubriche={{
          '1218': 'Responsabilità del debitore',
          '2043': 'Risarcimento per fatto illecito',
        }}
      />,
    );

    // Typed without the accent, as anyone actually types it.
    fireEvent.change(filterInput(), { target: { value: 'responsabilita' } });

    expect(
      screen.getByRole('button', { name: '1218 Responsabilità del debitore' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '2043 Risarcimento per fatto illecito' }),
    ).not.toBeInTheDocument();
  });

  it('reports how many articles the filter kept', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1', '12', '120', '2043']}
        urn="urn:test"
      />,
    );

    fireEvent.change(filterInput(), { target: { value: '12' } });

    expect(screen.getByText('2 di 4')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1', '2']}
        urn="urn:test"
      />,
    );

    fireEvent.change(filterInput(), { target: { value: 'zzz' } });

    expect(screen.getByText('Nessun articolo corrisponde al filtro')).toBeInTheDocument();
  });
});

describe('TreeViewPanel — collapsible sections', () => {
  beforeEach(() => setViewport(false));

  /** `count` sections, each holding one article numbered 101, 201, 301… */
  function treeWithSections(count: number) {
    const nodes: string[] = [];
    for (let i = 1; i <= count; i++) {
      nodes.push(`SEZIONE ${i}`);
      nodes.push(`${i}01`);
    }
    return nodes;
  }

  it('keeps sections expanded at or below the eight-section threshold', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(3)}
        urn="urn:test"
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Comprimi SEZIONE 1' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '101' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '301' })).toBeInTheDocument();
  });

  it('starts collapsed above the threshold — the codice civile has 406 sections', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(9)}
        urn="urn:test"
      />,
    );

    // Headers are all there; the 9 articles under them are not.
    expect(screen.getByRole('button', { name: 'Espandi SEZIONE 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '101' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '901' })).not.toBeInTheDocument();
  });

  it('opens the section holding an already-loaded article', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(9)}
        urn="urn:test"
        loadedArticles={['401']}
      />,
    );

    expect(screen.getByRole('button', { name: '401' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '101' })).not.toBeInTheDocument();
  });

  it('expands a collapsed section from the keyboard', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(9)}
        urn="urn:test"
      />,
    );

    const header = screen.getByRole('button', { name: 'Espandi SEZIONE 1' });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(header, { key: 'Enter' });

    expect(screen.getByRole('button', { name: '101' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Comprimi SEZIONE 1' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('auto-expands matching sections while a filter is active', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(9)}
        urn="urn:test"
      />,
    );

    fireEvent.change(
      screen.getByLabelText('Filtra gli articoli per numero o rubrica'),
      { target: { value: '401' } },
    );

    expect(screen.getByRole('button', { name: '401' })).toBeInTheDocument();
    // Sections without a match drop out entirely.
    expect(screen.queryByRole('button', { name: /SEZIONE 1$/ })).not.toBeInTheDocument();
  });
});


describe('TreeViewPanel — index rows, the details that regress silently', () => {
  beforeEach(() => setViewport(false));

  it('keeps a 44px touch target on the drawer variant', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['2043']}
        urn="urn:test"
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    const row = screen.getByRole('button', { name: '2043 Risarcimento per fatto illecito' });
    expect(row.className).toContain('min-h-[44px]');
  });

  it('lets a long article id widen its own row instead of spilling out of it', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['3', '2409-octiesdecies']}
        urn="urn:test"
      />,
    );

    // A hard `w-11` (44px) with shrink-0 makes "2409-octiesdecies" overflow to
    // the LEFT, out of the row. The codici are full of these.
    const slot = screen.getByText('2409-octiesdecies');
    expect(slot.className).toContain('min-w-11');
    expect(slot.className).not.toMatch(/(^|\s)w-11(\s|$)/);
  });

  it('keeps a loaded article focusable and tooltipped', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['2043']}
        urn="urn:test"
        loadedArticles={['2043']}
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    const row = screen.getByRole('button', { name: /2043/ });
    // `disabled` would drop it from the tab order and suppress the native
    // tooltip in Chrome and Safari — and a loaded article is exactly the one a
    // lawyer is re-reading, whose truncated rubrica they most need in full.
    expect(row).not.toBeDisabled();
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAttribute('title', 'Risarcimento per fatto illecito');
  });

  it('does not re-select an article that is already loaded', () => {
    const onArticleSelect = vi.fn();
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['2043']}
        urn="urn:test"
        loadedArticles={['2043']}
        onArticleSelect={onArticleSelect}
      />,
    );

    // aria-disabled does not block clicks the way `disabled` did, so the guard
    // has to live in the handler.
    fireEvent.click(screen.getByRole('button', { name: /2043/ }));
    expect(onArticleSelect).not.toHaveBeenCalled();
  });

  it('toggles a section from the keyboard with Space, and swallows the scroll', () => {
    const sections = Array.from({ length: 9 }, (_, i) => [`SEZIONE ${i + 1}`, `${i + 1}`]).flat();
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={sections}
        urn="urn:test"
      />,
    );

    const header = screen.getAllByRole('button', { name: /Espandi/ })[0];
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    fireEvent(header, event);

    // Without preventDefault a Space press scrolls the panel instead of
    // toggling the section.
    expect(event.defaultPrevented).toBe(true);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });
});


describe('TreeViewPanel — article ids past "decies"', () => {
  beforeEach(() => setViewport(false));

  // Normattiva numbers well past decies and a lawyer cites these constantly.
  // An enumerated suffix list reclassified each one as a SECTION TITLE, so the
  // article vanished from the index instead of being listed.
  const LONG_IDS = ['25-undecies', '669-terdecies', '452-quaterdecies', '2409-octiesdecies', '281-undecies'];

  it.each(LONG_IDS)('lists art. %s as an article, not a section header', (id) => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1', id]}
        urn="urn:test"
      />,
    );

    expect(screen.getByRole('button', { name: new RegExp(id) })).toBeInTheDocument();
  });

  it('still treats an uppercase multi-word heading as a section title', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA', '1', '2']}
        urn="urn:test"
      />,
    );

    // It must not have become a clickable article row.
    expect(
      screen.queryByRole('button', { name: 'LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA' }),
    ).not.toBeInTheDocument();
  });
});


describe('TreeViewPanel — titles follow the annex', () => {
  beforeEach(() => setViewport(false));

  // Every annex has its own article 1. Labelling them all from one flat map
  // showed the Dispositivo's art. 1 as "Capacità giuridica" — the rubrica of
  // art. 1 of the code body, a different article entirely.
  const ANNEXES = [
    { number: null, label: 'Dispositivo', article_count: 2, article_numbers: ['1', '2'] },
    { number: '2', label: 'CODICE CIVILE', article_count: 3, article_numbers: ['1', '2', '3'] },
  ];
  const PARTS: RubrichePart[] = [
    { name: 'Dispositivo', keys: ['1', '2'], rubriche: {}, abrogati: [] },
    {
      name: 'CODICE CIVILE',
      keys: ['1', '2', '3'],
      rubriche: { '1': 'Capacità giuridica', '2': 'Maggiore età' },
      abrogati: ['3'],
    },
  ];

  it('leaves the Dispositivo unlabelled instead of borrowing the code body titles', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={[{ allegato: null, numero: '1' }, { allegato: null, numero: '2' }]}
        urn="urn:test"
        annexes={ANNEXES}
        currentAnnex={null}
        // The flat map is what the backend also sends for the DOMINANT part.
        // Passing it here is the point of the test: the per-annex breakdown has
        // to win, or the Dispositivo wears the code body's titles again.
        rubriche={{ '1': 'Capacità giuridica', '2': 'Maggiore età' }}
        rubricheParts={PARTS}
      />,
    );

    expect(screen.queryByText('Capacità giuridica')).not.toBeInTheDocument();
    expect(screen.queryByText('Maggiore età')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^1$/ })).toBeInTheDocument();
  });

  it('labels the code body from its own part', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={[
          { allegato: '2', numero: '1' },
          { allegato: '2', numero: '2' },
          { allegato: '2', numero: '3' },
        ]}
        urn="urn:test"
        annexes={ANNEXES}
        currentAnnex="2"
        rubricheParts={PARTS}
      />,
    );

    expect(screen.getByText('Capacità giuridica')).toBeInTheDocument();
    expect(screen.getByText('Maggiore età')).toBeInTheDocument();
  });

  it('marks a repealed article instead of leaving the row blank', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={[{ allegato: '2', numero: '3' }]}
        urn="urn:test"
        annexes={ANNEXES}
        currentAnnex="2"
        rubricheParts={PARTS}
      />,
    );

    expect(screen.getByText('Abrogato')).toBeInTheDocument();
  });

  it('falls back to the flat map when no part matches the annex', () => {
    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['2043']}
        urn="urn:test"
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
        rubricheParts={[]}
      />,
    );

    expect(screen.getByText('Risarcimento per fatto illecito')).toBeInTheDocument();
  });
});
