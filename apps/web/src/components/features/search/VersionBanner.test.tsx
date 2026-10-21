import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionBanner } from './VersionBanner';
import { describeVersion } from '../../../utils/versionDisplay';
import type { ArticleValidity } from '../../../types';

const MIDDLE: ArticleValidity = {
    state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true,
};
const NOT_YET: ArticleValidity = {
    state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};

function bannerOf(validity: ArticleValidity, data_versione = '2005-06-01') {
    const banner = describeVersion(validity, { versione: 'vigente', data_versione }).banner;
    if (!banner) throw new Error('expected a banner');
    return banner;
}

describe('VersionBanner — a past text', () => {
    it('says which window, that it is not the current text, and what the window does not say', () => {
        render(<VersionBanner banner={bannerOf(MIDDLE)} onAction={() => {}} />);
        expect(screen.getByRole('status')).toHaveTextContent('Testo storico');
        expect(screen.getByText(/In vigore dal 25 dicembre 2003 al 29 dicembre 2007/)).toBeInTheDocument();
        expect(screen.getByText(/Non è il testo attuale/)).toBeInTheDocument();
        expect(screen.getByText(/non dice quale disciplina si applichi al fatto/)).toBeInTheDocument();
        expect(screen.getByText('Note ed evidenziazioni non sono mostrate su un testo storico.')).toBeInTheDocument();
    });

    it('offers the way back to the text in force and the citation', () => {
        const onAction = vi.fn();
        render(<VersionBanner banner={bannerOf(MIDDLE)} onAction={onAction} />);
        fireEvent.click(screen.getByRole('button', { name: 'Vai al testo attuale' }));
        fireEvent.click(screen.getByRole('button', { name: 'Copia citazione' }));
        expect(onAction.mock.calls).toEqual([['go_current'], ['copy_citation']]);
    });

    it('only informs when nothing handles the actions (the dossier reader)', () => {
        render(<VersionBanner banner={bannerOf(MIDDLE)} />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

describe('VersionBanner — an article that did not exist yet', () => {
    it('stands where the text would be, with the way forward', () => {
        const onAction = vi.fn();
        render(<VersionBanner banner={bannerOf(NOT_YET, '2010-01-01')} onAction={onAction} variant="state" />);
        expect(screen.getByText('Questo articolo non esisteva al 1° gennaio 2010. È in vigore dal 13 settembre 2014.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Vai al testo del 13 settembre 2014' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scegli un’altra data' }));
        expect(onAction.mock.calls).toEqual([['open_next_day'], ['pick_date']]);
    });
});

describe('VersionBanner — the way forward elides before the 11th', () => {
    it("reads \"Vai al testo dell'11 settembre 2014\" and keeps \"del 13\" as it was", () => {
        const elevenNext: ArticleValidity = { ...NOT_YET, valid_to: '2014-09-10' };
        const { unmount } = render(<VersionBanner banner={bannerOf(elevenNext, '2010-01-01')} onAction={() => {}} variant="state" />);
        expect(screen.getByRole('button', { name: "Vai al testo dell'11 settembre 2014" })).toBeInTheDocument();
        unmount();
        render(<VersionBanner banner={bannerOf(NOT_YET, '2010-01-01')} onAction={() => {}} variant="state" />);
        expect(screen.getByRole('button', { name: 'Vai al testo del 13 settembre 2014' })).toBeInTheDocument();
    });

    it('writes the first of a month with its ordinal on the button too', () => {
        const firstNext: ArticleValidity = { ...NOT_YET, valid_to: '2014-08-31' };
        render(<VersionBanner banner={bannerOf(firstNext, '2010-01-01')} onAction={() => {}} variant="state" />);
        expect(screen.getByRole('button', { name: 'Vai al testo del 1° settembre 2014' })).toBeInTheDocument();
    });
});

describe('VersionBanner — touch targets and layout on a narrow screen', () => {
    it('gives every action button a 44px target on mobile', () => {
        render(<VersionBanner banner={bannerOf(NOT_YET, '2010-01-01')} onAction={() => {}} variant="state" />);
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) expect(button).toHaveClass('min-h-[44px]', 'md:min-h-0');
    });

    it('stacks the icon above the text in the state variant', () => {
        render(<VersionBanner banner={bannerOf(NOT_YET, '2010-01-01')} onAction={() => {}} variant="state" />);
        const container = screen.getByRole('status');
        expect(container).toHaveClass('flex-col', 'items-center');
        expect(container).not.toHaveClass('justify-center');
    });

    it('keeps the icon beside the text in the banner variant', () => {
        render(<VersionBanner banner={bannerOf(MIDDLE)} onAction={() => {}} />);
        expect(screen.getByRole('status')).not.toHaveClass('flex-col');
    });
});

describe('VersionBanner — a version that does not contain the day', () => {
    it('warns as an alert and offers no citation', () => {
        const banner = bannerOf({ ...MIDDLE, request_in_window: false }, '2010-01-01');
        render(<VersionBanner banner={banner} onAction={() => {}} />);
        expect(screen.getByRole('alert')).toHaveTextContent('non va considerata attendibile');
        expect(screen.queryByRole('button', { name: 'Copia citazione' })).not.toBeInTheDocument();
    });
});

describe('VersionBanner — a date inside the text in force', () => {
    it('says so, without actions', () => {
        const banner = bannerOf({ ...MIDDLE, state: 'current', valid_to: null }, '2026-03-01');
        render(<VersionBanner banner={banner} onAction={() => {}} />);
        expect(screen.getByRole('status')).toHaveTextContent('La data richiesta cade nel testo attuale.');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

describe('VersionBanner — an article that will change (V1, G-355)', () => {
    // As the server answers after #276: today's text, its window ending the day before the later one.
    const TODAY: ArticleValidity = {
        state: 'current', valid_from: '1986-07-01', valid_to: '2026-12-31', version_number: 1, act_updated: null, request_in_window: null,
    };
    const later = (change: 'abrogated' | 'amended') => ({ change, valid_from: '2027-01-01', version_number: 2 });
    const undated = { versione: 'vigente' };

    it('says the article is repealed from that day, written in full, and that the text is today\'s', () => {
        const display = describeVersion(TODAY, undated, later('abrogated'));
        render(<VersionBanner banner={display.banner!} />);
        expect(screen.getByRole('status')).toHaveTextContent('Dal 1° gennaio 2027 questo articolo è abrogato.Qui leggi il testo in vigore oggi.');
        expect(screen.queryByText(/2027-01-01/)).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('says it changes, when amended', () => {
        render(<VersionBanner banner={describeVersion(TODAY, undated, later('amended')).banner!} />);
        expect(screen.getByRole('status')).toHaveTextContent('Dal 1° gennaio 2027 questo articolo cambia.');
    });

    it('elides the preposition before 8 and 11, as every date of the app', () => {
        const title = (valid_from: string) => describeVersion(TODAY, undated, { change: 'amended', valid_from, version_number: null }).banner!.title;
        expect(title('2027-08-08')).toBe("Dall'8 agosto 2027 questo articolo cambia.");
        expect(title('2027-03-11')).toBe("Dall'11 marzo 2027 questo articolo cambia.");
    });

    it('marks the chip «Cambia dal …» in the same tone, and keeps today\'s window in its title', () => {
        const chip = describeVersion(TODAY, undated, later('abrogated')).chip!;
        expect(chip).toMatchObject({ tone: 'upcoming', label: 'Cambia dal 01-01-2027' });
        expect(chip.title).toContain('In vigore dal 01-07-1986');
        expect(chip.title).toContain('è abrogato');
    });

    it('shows nothing without `upcoming`, as before', () => {
        const display = describeVersion(TODAY, undated);
        expect(display.banner).toBeNull();
        expect(display.chip?.tone).toBe('current');
    });

    it('says nothing of it on a text asked for by date or as the original, which the server does not mark', () => {
        expect(describeVersion(TODAY, { versione: 'vigente', data_versione: '2020-01-01' }, later('abrogated')).banner?.kind).not.toBe('upcoming');
        expect(describeVersion(TODAY, { versione: 'originale' }, later('abrogated')).banner).toBeNull();
    });

    it('changes nothing else: today\'s text can be annotated, cited and copied', () => {
        const display = describeVersion(TODAY, undated, later('abrogated'));
        expect(display).toMatchObject({ readOnly: false, canCite: true, canCopyOrSave: true, textVisible: true });
    });
});
