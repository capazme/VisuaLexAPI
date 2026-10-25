import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadingToolbar, type ReadingToolbarProps } from './ReadingToolbar';
import { NOT_YET_REASON, READ_ONLY_REASON, UNRELIABLE_REASON } from '../../../utils/versionDisplay';
import { appStore } from '../../../store/useAppStore';

function setup(over: Partial<ReadingToolbarProps> = {}) {
    const props: ReadingToolbarProps = {
        normaData: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1284' },
        versionChip: null,
        articleText: 'testo',
        isNotesPeekOpen: false,
        notesCount: 0,
        isHighlightsPeekOpen: false,
        highlightsCount: 0,
        isDiscussionOpen: false,
        isPinnedQuick: false,
        onToggleNotes: vi.fn(),
        onToggleHighlightsPeek: vi.fn(),
        onToggleDiscussion: vi.fn(),
        onToggleQuickNorm: vi.fn(),
        onMobileCopy: vi.fn(),
        onOpenStudyMode: vi.fn(),
        onOpenCopyModal: vi.fn(),
        onOpenDossier: vi.fn(),
        onShareLink: vi.fn(),
        onOpenAdvancedExport: vi.fn(),
        onOpenVersionInput: vi.fn(),
        onCompare: vi.fn(),
        ...over,
    };
    const { container } = render(<ReadingToolbar {...props} />);
    return { ...props, container };
}

const HISTORICAL_CHIP = {
    tone: 'historical' as const,
    label: 'Testo storico · dal 25 dicembre 2003 al 29 dicembre 2007',
    title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.',
};

// Both rows are mounted, one hidden by CSS.
const desktopRow = (container: HTMLElement) => container.querySelector<HTMLElement>('div.hidden.md\\:flex')!;
const phoneRow = (container: HTMLElement) => container.querySelector<HTMLElement>('div.flex.md\\:hidden')!;
/** Opens the «⋯» of a row and returns its entries' names. */
function openMore(row: HTMLElement) {
    fireEvent.click(within(row).getByRole('button', { name: 'Altre azioni sull’articolo' }));
    return within(row).getByRole('menu');
}
/** An entry's label, without the line a switched-off one carries under it. */
const entryNames = (menu: HTMLElement) =>
    within(menu).getAllByRole('menuitem').map((item) => item.querySelector('span > span')?.textContent ?? item.textContent);

describe('ReadingToolbar — the status, in words', () => {
    it('shows the window the source stated and opens the date dialog from it', () => {
        const props = setup({ versionChip: HISTORICAL_CHIP });
        fireEvent.click(screen.getByRole('button', { name: HISTORICAL_CHIP.label }));
        expect(props.onOpenVersionInput).toHaveBeenCalledTimes(1);
    });

    it('is words in `text-sm`, not a pill', () => {
        setup({ versionChip: { tone: 'current', label: 'In vigore dal 1° gennaio 2005', title: '' } });
        const status = screen.getByRole('button', { name: 'In vigore dal 1° gennaio 2005' });
        expect(status).toHaveClass('text-sm', 'text-slate-600');
        expect(status.className).not.toMatch(/\bbg-|rounded-full|border/);
    });

    it('claims nothing when the source stated nothing: no "Vigente" by default', () => {
        setup();
        expect(screen.queryByText(/Vigente|Storica|Aggiornato al/)).not.toBeInTheDocument();
    });

    it('does not echo the date that was typed as if the source had given it', () => {
        setup({ normaData: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1284', data_versione: '2005-06-01' } });
        expect(screen.queryByText(/2005-06-01/)).not.toBeInTheDocument();
    });

    it('names the annex in words, with no stray separator when there is no status', () => {
        const { container } = setup({ normaData: { tipo_atto: 'legge', data: '1990-08-07', numero_articolo: '1', allegato: 'A' } });
        expect(screen.getByText('Allegato A')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/[|·]/);
    });

    it('names no annex of a code: the codice civile is Allegato 2 of its decree, which no lawyer writes', () => {
        setup({ normaData: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1453', allegato: '2' } });
        expect(screen.queryByText(/Allegato/)).not.toBeInTheDocument();
    });

    it('puts a quiet dot between the status and the annex', () => {
        const { container } = setup({ versionChip: HISTORICAL_CHIP, normaData: { tipo_atto: 'legge', data: '1990-08-07', numero_articolo: '1', allegato: '2' } });
        expect(container.querySelector('span[aria-hidden]')?.textContent).toBe('·');
    });
});

describe('ReadingToolbar — one line beside the text', () => {
    it('has no box of its own: a hairline under it, no rounded border around it', () => {
        const { container } = setup();
        const bar = container.firstElementChild!;
        // One row on a phone (the status wraps inside its part); the tools may wrap from `md`.
        expect(bar).toHaveClass('border-b', 'md:flex-wrap');
        expect(bar.className).not.toMatch(/rounded|shadow/);
    });
});

describe('ReadingToolbar — three tools in words, the rest behind «⋯» (R3)', () => {
    it('on a computer: «Note», «Evidenziazioni», «Al dossier» and «⋯»', () => {
        const { container } = setup({ notesCount: 2, highlightsCount: 3 });
        const names = within(desktopRow(container)).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
        expect(names).toEqual(['Note, 2', 'Evidenziazioni, 3', 'Colore delle evidenziazioni: giallo', 'Al dossier', 'Altre azioni sull’articolo']);
        // The count is seen beside the word.
        expect(within(desktopRow(container)).getByRole('button', { name: 'Note, 2' })).toHaveTextContent('Note2');
    });

    it('on a phone: «Al dossier» (its icon, named) and «⋯», 44 px each', () => {
        const { container } = setup();
        const buttons = within(phoneRow(container)).getAllByRole('button');
        expect(buttons[0]).toHaveTextContent('');
        // Close together, the last one's target reaching into the page's margin: the status keeps one line at 320 (R3b).
        expect(phoneRow(container)).toHaveClass('-mr-3');
        expect(phoneRow(container)).not.toHaveClass('gap-1');
        expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Al dossier', 'Altre azioni sull’articolo']);
        buttons.forEach((b) => expect(b).toHaveClass('min-h-[44px]', 'min-w-[44px]'));
    });

    it('the visible tools are 36 px on a computer, neutral (no colour of their own)', () => {
        const { container } = setup();
        within(desktopRow(container)).getAllByRole('button').forEach((b) => {
            expect(b).toHaveClass('md:h-9');
            expect(b.className).not.toMatch(/(amber|purple|blue|emerald|violet)-/);
        });
    });

    it('the computer\'s «⋯» holds every other tool', () => {
        const { container } = setup({ find: { isOpen: false, onToggle: vi.fn() }, url: 'https://example.org/art' });
        expect(entryNames(openMore(desktopRow(container)))).toEqual([
            'Aggiungi alle norme rapide', 'Glosse sull’articolo', 'Cerca nel testo', 'Copia',
            'Condividi link', 'Esporta…', 'Testo alla data…', 'Confronta con…',
        ]);
    });

    it('the phone\'s «⋯» adds Study Mode and the source, which its row does not show', () => {
        const { container } = setup({ find: { isOpen: false, onToggle: vi.fn() }, url: 'https://example.org/art' });
        expect(entryNames(openMore(phoneRow(container)))).toEqual([
            'Aggiungi alle norme rapide', 'Glosse sull’articolo', 'Cerca nel testo', 'Copia', 'Modalità studio', 'Apri la fonte',
            'Condividi link', 'Esporta…', 'Testo alla data…', 'Confronta con…',
        ]);
    });

    it('runs each entry\'s action', () => {
        const props = setup();
        const row = desktopRow(props.container);
        const run = (name: string) => {
            fireEvent.click(within(openMore(row)).getByRole('menuitem', { name }));
        };
        run('Aggiungi alle norme rapide');
        expect(props.onToggleQuickNorm).toHaveBeenCalledTimes(1);
        run('Glosse sull’articolo');
        expect(props.onToggleDiscussion).toHaveBeenCalledTimes(1);
        run('Copia');
        expect(props.onOpenCopyModal).toHaveBeenCalledTimes(1);
        run('Condividi link');
        expect(props.onShareLink).toHaveBeenCalledTimes(1);
        run('Esporta…');
        expect(props.onOpenAdvancedExport).toHaveBeenCalledTimes(1);
        run('Testo alla data…');
        expect(props.onOpenVersionInput).toHaveBeenCalledTimes(1);
        run('Confronta con…');
        expect(props.onCompare).toHaveBeenCalledTimes(1);
    });

    it('copies on a phone at once, and opens Study Mode from its «⋯»', () => {
        const props = setup();
        const row = phoneRow(props.container);
        fireEvent.click(within(openMore(row)).getByRole('menuitem', { name: 'Copia' }));
        expect(props.onMobileCopy).toHaveBeenCalledTimes(1);
        expect(props.onOpenCopyModal).not.toHaveBeenCalled();
        fireEvent.click(within(openMore(row)).getByRole('menuitem', { name: 'Modalità studio' }));
        expect(props.onOpenStudyMode).toHaveBeenCalledTimes(1);
    });

    it('says what the entries do when they are on', () => {
        const { container } = setup({ isPinnedQuick: true, isDiscussionOpen: true });
        const names = entryNames(openMore(desktopRow(container)));
        expect(names).toContain('Togli dalle norme rapide');
        expect(names).toContain('Chiudi le glosse');
    });

    it('opens the notes and the highlights from their words', () => {
        const props = setup();
        const row = desktopRow(props.container);
        fireEvent.click(within(row).getByRole('button', { name: 'Note' }));
        fireEvent.click(within(row).getByRole('button', { name: 'Evidenziazioni' }));
        fireEvent.click(within(row).getByRole('button', { name: 'Al dossier' }));
        expect(props.onToggleNotes).toHaveBeenCalledTimes(1);
        expect(props.onToggleHighlightsPeek).toHaveBeenCalledTimes(1);
        expect(props.onOpenDossier).toHaveBeenCalledTimes(1);
    });
});

describe('ReadingToolbar — a past text is a reading', () => {
    it('switches off the tools keyed by article, and says why', () => {
        const { container } = setup({ lockedReason: READ_ONLY_REASON });
        const row = desktopRow(container);
        for (const name of ['Note', 'Evidenziazioni']) {
            const button = within(row).getByRole('button', { name });
            expect(button).toBeDisabled();
            expect(button.title).toContain(READ_ONLY_REASON);
        }
        const menu = openMore(row);
        for (const name of ['Aggiungi alle norme rapide', 'Glosse sull’articolo']) {
            const entry = within(menu).getByRole('menuitem', { name: new RegExp(name) });
            expect(entry).toBeDisabled();
            expect(entry).toHaveTextContent(READ_ONLY_REASON);
        }
        const phoneMenu = openMore(phoneRow(container));
        expect(within(phoneMenu).getByRole('menuitem', { name: /Modalità studio/ })).toBeDisabled();
    });

    it('offers no colour for new highlights, on a text that takes none (H1)', () => {
        const { container } = setup({ lockedReason: READ_ONLY_REASON });
        expect(within(desktopRow(container)).queryByRole('button', { name: /^Colore delle evidenziazioni/ })).toBeNull();
        expect(within(openMore(phoneRow(container))).queryAllByRole('menuitemradio')).toEqual([]);
    });

    it('leaves the reading tools alone', () => {
        const { container } = setup({ lockedReason: READ_ONLY_REASON });
        screen.getAllByRole('button', { name: 'Al dossier' }).forEach((button) => expect(button).toBeEnabled());
        const menu = openMore(desktopRow(container));
        for (const name of ['Copia', 'Condividi link', 'Testo alla data…', 'Confronta con…']) {
            expect(within(menu).getByRole('menuitem', { name })).toBeEnabled();
        }
    });

    it('does not fire a switched-off tool', () => {
        const props = setup({ lockedReason: READ_ONLY_REASON });
        fireEvent.click(within(desktopRow(props.container)).getByRole('button', { name: 'Note' }));
        expect(props.onToggleNotes).not.toHaveBeenCalled();
    });

    it('has every tool on for the text in force', () => {
        const { container } = setup();
        within(desktopRow(container)).getAllByRole('button').forEach((button) => expect(button).toBeEnabled());
        within(openMore(desktopRow(container))).getAllByRole('menuitem').forEach((entry) => expect(entry).toBeEnabled());
    });
});

describe('ReadingToolbar — there is no article to copy or save', () => {
    it('switches off copying and the dossier', () => {
        const reason = 'Non disponibile: l’articolo non esisteva a quella data';
        const { container } = setup({ copyLockedReason: reason });
        screen.getAllByRole('button', { name: 'Al dossier' }).forEach((button) => {
            expect(button).toBeDisabled();
            expect(button.title).toContain(reason);
        });
        const copy = within(openMore(desktopRow(container))).getByRole('menuitem', { name: /Copia/ });
        expect(copy).toBeDisabled();
        expect(copy).toHaveTextContent(reason);
    });
});

describe('ReadingToolbar — the export', () => {
    it('exports the text in force (the control)', () => {
        const props = setup();
        const entry = within(openMore(desktopRow(props.container))).getByRole('menuitem', { name: 'Esporta…' });
        expect(entry).toBeEnabled();
        fireEvent.click(entry);
        expect(props.onOpenAdvancedExport).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a past text', { lockedReason: READ_ONLY_REASON }, READ_ONLY_REASON],
        ['an article that did not exist yet', { copyLockedReason: NOT_YET_REASON }, NOT_YET_REASON],
        ['an unreliable version', { lockedReason: READ_ONLY_REASON, copyLockedReason: UNRELIABLE_REASON }, UNRELIABLE_REASON],
    ])('does not export %s, and says why', (_name, over, reason) => {
        const props = setup(over);
        const entry = within(openMore(desktopRow(props.container))).getByRole('menuitem', { name: /Esporta…/ });
        expect(entry).toBeDisabled();
        expect(entry).toHaveTextContent(reason);
        fireEvent.click(entry);
        expect(props.onOpenAdvancedExport).not.toHaveBeenCalled();
    });

    it('still opens the date dialog and the comparison on a past text', () => {
        const { container } = setup({ lockedReason: READ_ONLY_REASON, copyLockedReason: UNRELIABLE_REASON });
        const menu = openMore(desktopRow(container));
        expect(within(menu).getByRole('menuitem', { name: 'Testo alla data…' })).toBeEnabled();
        expect(within(menu).getByRole('menuitem', { name: 'Confronta con…' })).toBeEnabled();
        expect(within(menu).getByRole('menuitem', { name: 'Condividi link' })).toBeEnabled();
    });
});

describe('ReadingToolbar — «Cerca nel testo»', () => {
    const find = (over: Partial<NonNullable<ReadingToolbarProps['find']>> = {}) => ({
        isOpen: false, onToggle: vi.fn(), ...over,
    });

    it('is an entry of «⋯» on both rows', () => {
        const { container } = setup({ find: find() });
        expect(within(openMore(desktopRow(container))).getByRole('menuitem', { name: 'Cerca nel testo' })).toBeInTheDocument();
        expect(within(openMore(phoneRow(container))).getByRole('menuitem', { name: 'Cerca nel testo' })).toBeInTheDocument();
    });

    it('is not offered when there is nothing to search', () => {
        const { container } = setup();
        expect(within(openMore(desktopRow(container))).queryByRole('menuitem', { name: 'Cerca nel testo' })).not.toBeInTheDocument();
    });

    it('hands the window the «⋯» of the row on screen, to give the focus back to', () => {
        const f = find();
        const { container } = setup({ find: f });
        const desktopMore = within(desktopRow(container)).getByRole('button', { name: 'Altre azioni sull’articolo' });
        const phoneMore = within(phoneRow(container)).getByRole('button', { name: 'Altre azioni sull’articolo' });
        // jsdom has no layout: say which row is on screen.
        desktopMore.getClientRects = () => [{}] as unknown as DOMRectList;
        fireEvent.click(within(openMore(phoneRow(container))).getByRole('menuitem', { name: 'Cerca nel testo' }));
        expect(f.onToggle).toHaveBeenLastCalledWith(desktopMore, false);
        desktopMore.getClientRects = () => [] as unknown as DOMRectList;
        fireEvent.click(within(openMore(desktopRow(container))).getByRole('menuitem', { name: 'Cerca nel testo' }));
        expect(f.onToggle).toHaveBeenLastCalledWith(phoneMore, false);
    });

    it('says it closes the window when it is open on this text', () => {
        const f = find({ isOpen: true });
        const { container } = setup({ find: f });
        fireEvent.click(within(openMore(desktopRow(container))).getByRole('menuitem', { name: 'Chiudi la ricerca nel testo' }));
        expect(f.onToggle).toHaveBeenLastCalledWith(expect.anything(), true);
    });
});

describe('ReadingToolbar — the compact form of a light window (spec §4.1)', () => {
    const find = { isOpen: false, onToggle: vi.fn() };

    it('the computer\'s row holds notes, highlights, their colour and «⋯»: discussions, the magnifier and copy', () => {
        const { container } = setup({ compact: true, find, url: 'https://example.org/x' });
        const row = desktopRow(container);
        expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent))
            .toEqual(['Note', 'Evidenziazioni', 'Colore delle evidenziazioni: giallo', 'Altre azioni sull’articolo']);
        expect(entryNames(openMore(row))).toEqual(['Glosse sull’articolo', 'Cerca nel testo', 'Copia']);
    });

    it('the phone\'s row holds «⋯» alone: no quick norm, dossier, Study Mode or source link', () => {
        const { container } = setup({ compact: true, find, url: 'https://example.org/x' });
        const row = phoneRow(container);
        // The card's padding is its edge (the full-screen reader): no reach into it, which cut the focus ring (R3b).
        expect(row).not.toHaveClass('-mr-3');
        expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Altre azioni sull’articolo']);
        expect(entryNames(openMore(row))).toEqual(['Glosse sull’articolo', 'Cerca nel testo', 'Copia']);
    });

    it('keeps the status and the annex, which say which text this is', () => {
        setup({ compact: true, versionChip: HISTORICAL_CHIP, normaData: { tipo_atto: 'legge', data: '1990-08-07', numero_articolo: '1', allegato: 'A' } });
        expect(screen.getByRole('button', { name: HISTORICAL_CHIP.label })).toBeInTheDocument();
        expect(screen.getByText('Allegato A')).toBeInTheDocument();
    });
});

describe('ReadingToolbar — the colour of new highlights, chosen once (H1)', () => {
    const color = () => appStore.getState().settings.highlightColor;
    afterEach(() => appStore.setState((st) => ({ settings: { ...st.settings, highlightColor: 'yellow' } })));

    it('on a computer: a menu of its own beside «Evidenziazioni», each colour with what it is suggested for', () => {
        const { container } = setup();
        const row = desktopRow(container);
        const trigger = within(row).getByRole('button', { name: 'Colore delle evidenziazioni: giallo' });
        // The colour in words, not in a pale dot alone.
        expect(trigger).toHaveTextContent('Colore: giallo');
        fireEvent.click(trigger);
        const menu = within(row).getByRole('menu');
        const choices = within(menu).getAllByRole('menuitemradio');
        expect(choices.map((c) => [c.textContent, c.getAttribute('aria-checked')])).toEqual([
            ['GialloPunto centrale', 'true'],
            ['VerdeCondizione o presupposto', 'false'],
            ['RossoDa rivedere', 'false'],
            ['BluDefinizione o eccezione', 'false'],
        ]);
        expect(choices[0]).toHaveAccessibleName('Giallo, punto centrale');
        fireEvent.click(choices[1]);
        expect(color()).toBe('green');
        expect(within(row).getByRole('button', { name: 'Colore delle evidenziazioni: verde' })).toBeInTheDocument();
    });

    it('on a phone, where the row has no room: its four choices close the «⋯», under a title, as a setting', () => {
        const { container } = setup();
        const menu = openMore(phoneRow(container));
        // Long now: capped under the bar, it scrolls on its own, so the last colour is never off the screen.
        expect(menu).toHaveClass('overflow-y-auto', 'max-h-[calc(100dvh-12rem)]');
        expect(within(menu).getByText('Colore delle nuove evidenziazioni')).toBeInTheDocument();
        const choices = within(menu).getAllByRole('menuitemradio');
        // Named for what they set, never «Evidenzia in…», which reads as «highlight now».
        expect(choices.map((c) => c.getAttribute('aria-label'))).toEqual([
            'Nuove evidenziazioni in giallo, punto centrale', 'Nuove evidenziazioni in verde, condizione o presupposto',
            'Nuove evidenziazioni in rosso, da rivedere', 'Nuove evidenziazioni in blu, definizione o eccezione',
        ]);
        expect(choices.map((c) => c.textContent)).toEqual([
            'GialloPunto centrale', 'VerdeCondizione o presupposto', 'RossoDa rivedere', 'BluDefinizione o eccezione',
        ]);
        expect(choices[0]).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(choices[3]);
        expect(color()).toBe('blue');
    });
});
