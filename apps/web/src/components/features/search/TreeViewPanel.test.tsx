import React from 'react';
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
    structureWindow: { blockId: 'block-a' },
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('TreeViewPanel — on a computer, in the card (LC77)', () => {
  beforeEach(() => setViewport(true));

  it('renders the index in its own place in the page: no portal, no dialog, nothing fixed', () => {
    const { container } = render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['1', '2']}
        urn="urn:test"
        title="Struttura Atto"
      />,
    );

    const region = screen.getByRole('region', { name: 'Struttura Atto' });
    expect(container).toContainElement(region);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('.fixed')).toBeNull();
  });

  it('stays open after an article is picked', () => {
    const onArticleSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <TreeViewPanel
        isOpen
        onClose={onClose}
        treeData={['1', '2']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Art. 1' }));

    expect(onArticleSelect).toHaveBeenCalledWith('1', null);
    // Picking must not dismiss the window: taking several articles out of one
    // index without reopening it is the point of the round.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Art. 2' })).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    render(
      <TreeViewPanel
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

describe('TreeViewPanel — on a phone, in the page (LC77)', () => {
  beforeEach(() => setViewport(false));

  it('opens in the page, full width, not as a dialog over the whole screen', () => {
    const { container } = render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['1']}
        urn="urn:test"
        title="Struttura dell'Atto"
      />,
    );

    const region = screen.getByRole('region', { name: "Struttura dell'Atto" });
    expect(container).toContainElement(region);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('.fixed')).toBeNull();
    // Rows a finger can hit.
    expect(screen.getByRole('button', { name: 'Art. 1' }).className).toContain('min-h-[44px]');
  });

  it('also stays open after a pick', () => {
    const onClose = vi.fn();
    const onArticleSelect = vi.fn();

    render(
      <TreeViewPanel
        isOpen
        onClose={onClose}
        treeData={['1']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Art. 1' }));

    expect(onArticleSelect).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TreeViewPanel — rubriche', () => {
  beforeEach(() => setViewport(false));

  it('renders a rubrica beside its article number', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['2043', '2044']}
        urn="urn:test"
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Art. 2043 Risarcimento per fatto illecito' }),
    ).toBeInTheDocument();
    // Truncated to one line on screen, so the full text has to survive as a
    // tooltip.
    expect(
      screen.getByRole('button', { name: 'Art. 2043 Risarcimento per fatto illecito' }),
    ).toHaveAttribute('title', 'Risarcimento per fatto illecito');
  });

  it('renders the bare number for an article the export has no rubrica for', () => {
    render(
      <TreeViewPanel
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
      screen.getByRole('button', { name: 'Art. 2043 Risarcimento per fatto illecito' }),
    ).toBeInTheDocument();

    const bare = screen.getByRole('button', { name: 'Art. 2044' });
    expect(bare).toBeInTheDocument();
    expect(bare).not.toHaveAttribute('title');
  });

  it('survives an act with no rubriche at all (the Costituzione)', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['1', '2']}
        urn="urn:test"
        rubriche={{}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Art. 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Art. 2' })).toBeInTheDocument();
    // Zero coverage costs nothing: the index is still the same surface.
    expect(
      screen.getByLabelText('Filtra gli articoli per numero o rubrica'),
    ).toBeInTheDocument();
  });

  it('still hands onArticleSelect the same argument when a rubrica is shown', () => {
    const onArticleSelect = vi.fn();

    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['2043']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Art. 2043 Risarcimento per fatto illecito' }),
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
        isOpen
        onClose={vi.fn()}
        treeData={['1', '12', '120', '2043']}
        urn="urn:test"
      />,
    );

    fireEvent.change(filterInput(), { target: { value: '12' } });

    expect(screen.getByRole('button', { name: 'Art. 12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Art. 120' })).toBeInTheDocument();
    // Prefix, not substring: 2043 does not contain a leading "12" either way.
    expect(screen.queryByRole('button', { name: 'Art. 2043' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Art. 1' })).not.toBeInTheDocument();
  });

  it('matches by rubrica substring, ignoring accents', () => {
    render(
      <TreeViewPanel
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
      screen.getByRole('button', { name: 'Art. 1218 Responsabilità del debitore' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Art. 2043 Risarcimento per fatto illecito' }),
    ).not.toBeInTheDocument();
  });

  it('reports how many articles the filter kept', () => {
    render(
      <TreeViewPanel
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
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(3)}
        urn="urn:test"
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Sezione 1' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Art. 101' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Art. 301' })).toBeInTheDocument();
  });

  it('starts collapsed above the threshold — the codice civile has 406 sections', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(9)}
        urn="urn:test"
      />,
    );

    // Headers are all there; the 9 articles under them are not.
    expect(screen.getByRole('button', { name: 'Sezione 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Art. 101' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Art. 901' })).not.toBeInTheDocument();
  });

  it('opens the section holding an already-loaded article', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(9)}
        urn="urn:test"
        loadedArticles={['401']}
      />,
    );

    // On the table: its name says so to a screen reader.
    expect(screen.getByRole('button', { name: /^Art\. 401 ?, sul tavolo$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Art. 101' })).not.toBeInTheDocument();
  });

  it('expands a collapsed section from the keyboard', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={treeWithSections(9)}
        urn="urn:test"
      />,
    );

    const header = screen.getByRole('button', { name: 'Sezione 1' });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(header, { key: 'Enter' });

    expect(screen.getByRole('button', { name: 'Art. 101' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sezione 1' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('auto-expands matching sections while a filter is active', () => {
    render(
      <TreeViewPanel
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

    expect(screen.getByRole('button', { name: 'Art. 401' })).toBeInTheDocument();
    // Sections without a match drop out entirely.
    expect(screen.queryByRole('button', { name: /^Sezione 1$/ })).not.toBeInTheDocument();
  });
});


describe('TreeViewPanel — index rows, the details that regress silently', () => {
  beforeEach(() => setViewport(false));

  it('keeps a 44px touch target on a phone', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['2043']}
        urn="urn:test"
        rubriche={{ '2043': 'Risarcimento per fatto illecito' }}
      />,
    );

    const row = screen.getByRole('button', { name: 'Art. 2043 Risarcimento per fatto illecito' });
    expect(row.className).toContain('min-h-[44px]');
  });

  it('lets a long article id widen its own row instead of spilling out of it', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['3', '2409-octiesdecies']}
        urn="urn:test"
      />,
    );

    // A hard `w-11` (44px) with shrink-0 makes "2409-octiesdecies" overflow to
    // the LEFT, out of the row. The codici are full of these.
    const slot = screen.getByText('Art. 2409-octiesdecies');
    expect(slot.className).toContain('shrink-0');
    expect(slot.className).toContain('whitespace-nowrap');
    expect(slot.className).not.toMatch(/(^|\s)w-11(\s|$)/);
  });

  it('keeps a loaded article focusable and tooltipped', () => {
    render(
      <TreeViewPanel
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
        isOpen
        onClose={vi.fn()}
        treeData={sections}
        urn="urn:test"
      />,
    );

    const header = screen.getAllByRole('button', { name: /^Sezione/ })[0];
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
        isOpen
        onClose={vi.fn()}
        treeData={['LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA', '1', '2']}
        urn="urn:test"
      />,
    );

    // A heading of the tree, which opens and closes, not an article row.
    expect(
      screen.getByRole('button', { name: 'Libro primo delle persone e della famiglia' }),
    ).toHaveAttribute('aria-expanded', 'true');
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
    expect(screen.getByRole('button', { name: /^Art\. 1$/ })).toBeInTheDocument();
  });

  it('labels the code body from its own part', () => {
    render(
      <TreeViewPanel
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
        isOpen
        onClose={vi.fn()}
        treeData={[{ allegato: '2', numero: '3' }]}
        urn="urn:test"
        annexes={ANNEXES}
        currentAnnex="2"
        rubricheParts={PARTS}
      />,
    );

    expect(screen.getByText('abrogato')).toBeInTheDocument();
  });

  it('uses the flat map for an act with no parts', () => {
    render(
      <TreeViewPanel
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

  // Measured on d.lgs. 196/2003: its top-level map is the one of an annex of
  // «Regole deontologiche», so an act in parts whose annex cannot be matched
  // shows no titles rather than another part's.
  it('never falls back to the flat map for an act in parts', () => {
    render(
      <TreeViewPanel
        isOpen
        onClose={vi.fn()}
        treeData={['1', '2']}
        urn="urn:test"
        currentAnnex={null}
        rubriche={{ '1': 'Delibera del Garante n. 515 del 19 dicembre 2018' }}
        rubricheParts={[
          { name: 'Allegato A.4 Regole deontologiche', keys: ['1', '2', '3'], rubriche: { '1': 'Delibera del Garante n. 515 del 19 dicembre 2018' }, abrogati: [] },
          { name: 'Dispositivo', keys: ['1', '2', '2-bis'], rubriche: { '1': 'Oggetto' }, abrogati: [] },
        ]}
      />,
    );

    expect(screen.queryByText(/Delibera del Garante/)).not.toBeInTheDocument();
  });
});

describe('TreeViewPanel — LC71, the panel redone', () => {
  const CC_ANNEXES = [
    { number: null, label: 'Dispositivo', article_count: 2, article_numbers: ['1', '2'] },
    { number: '1', label: 'Disposizioni sulla legge in generale', article_count: 1, article_numbers: ['1'] },
    { number: '2', label: 'CODICE CIVILE', article_count: 2, article_numbers: ['2043', '2044'] },
  ];
  const CC_TREE = [
    { allegato: null, numero: '1' },
    { allegato: null, numero: '2' },
    'Disposizioni sulla legge in generale',
    'CAPO I Delle fonti del diritto',
    { allegato: '1', numero: '1' },
    'CODICE CIVILE',
    'LIBRO QUARTO Delle obbligazioni',
    'TITOLO IX Dei fatti illeciti',
    { allegato: '2', numero: '2043' },
    { allegato: '2', numero: '2044' },
  ];

  it('shows no statistics, no subtitle and a plain title', () => {
    setViewport(true);
    render(
      <TreeViewPanel isOpen onClose={vi.fn()} treeData={['1', '2']} urn="urn:test" title="Struttura del Codice civile" loadedArticles={['1']} />,
    );
    expect(screen.getByRole('heading', { name: 'Struttura del Codice civile' })).toBeInTheDocument();
    expect(screen.queryByText(/articoli totali/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/caricati/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/indice strutturale/i)).not.toBeInTheDocument();
  });

  it('opens on the part it is given, with the parts by their whole names in the act’s order', () => {
    setViewport(false);
    render(
      <TreeViewPanel isOpen onClose={vi.fn()} treeData={CC_TREE} urn="urn:test" annexes={CC_ANNEXES} currentAnnex="2" />,
    );
    const menu = screen.getByLabelText("Parte dell'atto") as HTMLSelectElement;
    expect(menu.value).toBe('2');
    expect(Array.from(menu.options).map((o) => o.text)).toEqual([
      'Dispositivo', 'Disposizioni sulla legge in generale', 'Codice civile',
    ]);
    // The code's own tree, nested: the book holds the title, the title the article.
    expect(screen.getByRole('button', { name: 'Libro quarto Delle obbligazioni' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Titolo IX Dei fatti illeciti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Art. 2043' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delle fonti del diritto/ })).not.toBeInTheDocument();
  });

  it('marks the open article and writes each row as «Art. n · rubrica»', () => {
    setViewport(false);
    render(
      <TreeViewPanel
        isOpen onClose={vi.fn()} treeData={CC_TREE} urn="urn:test" annexes={CC_ANNEXES} currentAnnex="2"
        loadedArticles={['all2:2043']} activeArticle="all2:2043"
        rubricheParts={[{ name: 'CODICE CIVILE', keys: ['2043', '2044'], rubriche: { '2043': 'Risarcimento per fatto illecito' }, abrogati: [] }]}
      />,
    );
    const open = screen.getByRole('button', { name: 'Art. 2043 Risarcimento per fatto illecito' });
    expect(open).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Art. 2044' })).not.toHaveAttribute('aria-current');
  });

  it('focuses the filter on opening, walks the rows with the arrows, and Esc gives the focus back', () => {
    setViewport(true);
    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Struttura</button>
          <TreeViewPanel isOpen={open} onClose={() => { onClose(); setOpen(false); }} treeData={['1', '2']} urn="urn:test" />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Struttura' });
    opener.focus();
    fireEvent.click(opener);

    // The space takes the focus, never the filter: no keyboard rising on a phone (LC105). The arrows start from it.
    const filter = screen.getByLabelText('Filtra gli articoli per numero o rubrica');
    const space = document.activeElement as HTMLElement;
    expect(space).toContainElement(filter);
    expect(space).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(space, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Art. 1' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Art. 1' }), { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Art. 2' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Art. 2' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('closes from its X on a phone, giving the focus back', () => {
    setViewport(false);
    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Struttura</button>
          <TreeViewPanel isOpen={open} onClose={() => { onClose(); setOpen(false); }} treeData={['1']} urn="urn:test" />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Struttura' });
    opener.focus();
    fireEvent.click(opener);
    const x = screen.getByRole('button', { name: 'Chiudi la struttura' });
    expect(x.className).toContain('h-11');
    fireEvent.click(x);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });
});

describe('TreeViewPanel — the consultant’s notes on #557', () => {
  beforeEach(() => setViewport(true));
  const panel = (extra: Partial<React.ComponentProps<typeof TreeViewPanel>> = {}) => (
    <TreeViewPanel isOpen onClose={vi.fn()} treeData={['1', '2', '3']} urn="urn:test" {...extra} />
  );

  it('empties a filled filter on the first Esc and closes on the second', () => {
    const onClose = vi.fn();
    render(panel({ onClose }));
    const filter = screen.getByLabelText('Filtra gli articoli per numero o rubrica');
    fireEvent.change(filter, { target: { value: '2' } });
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(filter).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('brings the list back to the top when the filter changes', () => {
    render(panel());
    const list = screen.getByRole('group', { name: "Indice dell'atto" });
    list.scrollTop = 300;
    fireEvent.change(screen.getByLabelText('Filtra gli articoli per numero o rubrica'), { target: { value: '3' } });
    expect(list.scrollTop).toBe(0);
  });

  it('marks the open article apart from a hovered row', () => {
    render(panel({ activeArticle: '2' }));
    const open = screen.getByRole('button', { name: 'Art. 2' });
    const other = screen.getByRole('button', { name: 'Art. 1' });
    expect(open.className).toContain('shadow-[inset_2px_0_0_currentColor]');
    expect(other.className).not.toContain('shadow-[inset_2px_0_0_currentColor]');
  });

  it('writes a row that is not an article as it is', () => {
    render(panel({ treeData: ['1', { numero: 'Indice allegati', allegato: null }] }));
    expect(screen.getByRole('button', { name: 'Indice allegati' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Art\. Indice/ })).not.toBeInTheDocument();
  });

  it('is one Tab stop: the open article’s row', () => {
    render(panel({ activeArticle: '2' }));
    expect(screen.getByRole('button', { name: 'Art. 2' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Art. 1' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Art. 3' })).toHaveAttribute('tabindex', '-1');
  });
});

