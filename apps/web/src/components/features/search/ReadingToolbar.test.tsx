import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReadingToolbar, type ReadingToolbarProps } from './ReadingToolbar';
import { NOT_YET_REASON, READ_ONLY_REASON, UNRELIABLE_REASON } from '../../../utils/versionDisplay';

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
        showMoreMenu: false,
        isPinnedQuick: false,
        onToggleNotes: vi.fn(),
        onToggleHighlightsPeek: vi.fn(),
        onToggleDiscussion: vi.fn(),
        onToggleMoreMenu: vi.fn(),
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
    label: 'Testo storico · dal 25-12-2003 al 29-12-2007',
    title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.',
};

describe('ReadingToolbar — the status', () => {
    it('shows the window the source stated and opens the date dialog from it', () => {
        const props = setup({ versionChip: HISTORICAL_CHIP });
        fireEvent.click(screen.getByRole('button', { name: HISTORICAL_CHIP.label }));
        expect(props.onOpenVersionInput).toHaveBeenCalledTimes(1);
    });

    it('claims nothing when the source stated nothing: no "Vigente" by default', () => {
        setup();
        expect(screen.queryByText(/Vigente|Storica|Aggiornato al/)).not.toBeInTheDocument();
    });

    it('does not echo the date that was typed as if the source had given it', () => {
        setup({ normaData: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1284', data_versione: '2005-06-01' } });
        expect(screen.queryByText(/2005-06-01/)).not.toBeInTheDocument();
    });

    it('keeps the annex badge, with no stray separator when there is no chip', () => {
        const { container } = setup({
            normaData: { tipo_atto: 'legge', data: '1990-08-07', numero_articolo: '1', allegato: 'A' },
        });
        expect(screen.getByText('Allegato A')).toBeInTheDocument();
        expect(container.textContent).not.toContain('|');
    });
});

describe('ReadingToolbar — a past text is a reading', () => {
    it('switches off the tools keyed by article, and says why in each tooltip', () => {
        setup({ lockedReason: READ_ONLY_REASON });
        for (const name of ['Aggiungi a norme rapide', 'Apri note', 'Gestisci evidenziazioni', 'Discussioni sull’articolo']) {
            const buttons = screen.getAllByTitle(`${name} — ${READ_ONLY_REASON}`);
            expect(buttons.length).toBeGreaterThan(0);
            buttons.forEach((button) => expect(button).toBeDisabled());
        }
        screen.getAllByTitle(`Modalità studio — ${READ_ONLY_REASON}`).forEach((button) => expect(button).toBeDisabled());
    });

    it('leaves the reading tools alone', () => {
        setup({ lockedReason: READ_ONLY_REASON });
        for (const title of ['Copia', 'Copia testo', 'Altre azioni']) {
            screen.getAllByTitle(title).forEach((button) => expect(button).toBeEnabled());
        }
        screen.getAllByLabelText('Aggiungi a dossier').forEach((button) => expect(button).toBeEnabled());
    });

    it('does not fire a switched-off tool', () => {
        const props = setup({ lockedReason: READ_ONLY_REASON });
        screen.getAllByTitle(`Apri note — ${READ_ONLY_REASON}`).forEach((button) => fireEvent.click(button));
        expect(props.onToggleNotes).not.toHaveBeenCalled();
    });

    it('has every tool on for the text in force', () => {
        setup();
        for (const title of ['Aggiungi a norme rapide', 'Apri note', 'Gestisci evidenziazioni', 'Discussioni sull’articolo', 'Copia']) {
            screen.getAllByTitle(title).forEach((button) => expect(button).toBeEnabled());
        }
    });
});

describe('ReadingToolbar — there is no article to copy or save', () => {
    it('switches off copying and the dossier', () => {
        setup({ copyLockedReason: 'Non disponibile: l’articolo non esisteva a quella data' });
        for (const name of ['Copia', 'Copia testo', 'Aggiungi a dossier']) {
            screen.getAllByTitle(`${name} — Non disponibile: l’articolo non esisteva a quella data`)
                .forEach((button) => expect(button).toBeDisabled());
        }
    });
});

describe('ReadingToolbar — the menu', () => {
    it('names the version action for what it does', () => {
        setup({ showMoreMenu: true });
        expect(screen.getByRole('button', { name: 'Testo alla data...' })).toBeInTheDocument();
        expect(screen.queryByText('Cerca versione...')).not.toBeInTheDocument();
    });

    it('opens the date dialog from it', () => {
        const props = setup({ showMoreMenu: true });
        fireEvent.click(screen.getByRole('button', { name: 'Testo alla data...' }));
        expect(props.onOpenVersionInput).toHaveBeenCalledTimes(1);
        expect(props.onToggleMoreMenu).toHaveBeenCalledWith(false);
    });

    it('exports the text in force (the control)', () => {
        const props = setup({ showMoreMenu: true });
        const entry = screen.getByRole('button', { name: 'Esporta...' });
        expect(entry).toBeEnabled();
        fireEvent.click(entry);
        expect(props.onOpenAdvancedExport).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a past text', { lockedReason: READ_ONLY_REASON }, READ_ONLY_REASON],
        ['an article that did not exist yet', { copyLockedReason: NOT_YET_REASON }, NOT_YET_REASON],
        ['an unreliable version', { lockedReason: READ_ONLY_REASON, copyLockedReason: UNRELIABLE_REASON }, UNRELIABLE_REASON],
    ])('does not export %s, and says why', (_name, over, reason) => {
        const props = setup({ showMoreMenu: true, ...over });
        const entry = screen.getByTitle(`Esporta... — ${reason}`);
        expect(entry).toBeDisabled();
        fireEvent.click(entry);
        expect(props.onOpenAdvancedExport).not.toHaveBeenCalled();
    });

    it('still opens the date dialog and the comparison on a past text', () => {
        setup({ showMoreMenu: true, lockedReason: READ_ONLY_REASON, copyLockedReason: UNRELIABLE_REASON });
        expect(screen.getByRole('button', { name: 'Testo alla data...' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Confronta con...' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Condividi link' })).toBeEnabled();
    });
});
