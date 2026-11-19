import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionStatusChip } from './VersionStatusChip';
import type { VersionChip } from '../../../utils/versionDisplay';

const chip = (over: Partial<VersionChip> = {}): VersionChip => ({
    tone: 'historical',
    label: 'Testo storico · dal 25 dicembre 2003 al 29 dicembre 2007',
    title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale. Versione n. 7.',
    ...over,
});

describe('VersionStatusChip', () => {
    it('states the window and carries the source note as its tooltip', () => {
        render(<VersionStatusChip chip={chip()} onClick={() => {}} />);
        const button = screen.getByRole('button', { name: 'Testo storico · dal 25 dicembre 2003 al 29 dicembre 2007' });
        expect(button).toHaveAttribute('title', expect.stringContaining('fa fede la Gazzetta Ufficiale'));
        // «Testo alla data» opens in the page (LC139, L-73): no window to announce.
        expect(button).not.toHaveAttribute('aria-haspopup');
    });

    it('is words in `text-sm`, not a pill, and keeps its 44px touch target (R3)', () => {
        render(<VersionStatusChip chip={chip()} onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('text-sm', 'min-h-[44px]', 'md:min-h-0', 'vlx-hover-tile');
        expect(button.className).not.toMatch(/\bbg-|\bpx-|rounded-full/);
    });

    it('under the pointer has the ground and no underline (LC73)', () => {
        render(<VersionStatusChip chip={chip()} onClick={() => {}} />);
        expect(screen.getByRole('button').className).not.toMatch(/underline/);
    });

    it('opens the date dialog when pressed', () => {
        const onClick = vi.fn();
        render(<VersionStatusChip chip={chip({ tone: 'current', label: 'In vigore dal 28 dicembre 2025' })} onClick={onClick} />);
        fireEvent.click(screen.getByRole('button', { name: 'In vigore dal 28 dicembre 2025' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['current', 'slate'],
        ['historical', 'amber'],
        ['abrogated', 'rose'],
        ['not_yet', 'slate'],
        ['upcoming', 'sky'],
    ] as const)('inks the %s state in its banner\'s tone (%s; the text in force neutral)', (tone, colour) => {
        render(<VersionStatusChip chip={chip({ tone, label: tone })} onClick={() => {}} />);
        expect(screen.getByRole('button', { name: tone }).className).toContain(colour);
    });

    it('on a phone the day in figures, on a computer in words; read in full either way (LC70)', () => {
        render(<VersionStatusChip
            chip={chip({ tone: 'current', label: 'In vigore dal 19 aprile 1942', short: 'In vigore dal 19/4/1942' })}
            onClick={() => {}}
        />);
        const button = screen.getByRole('button', { name: 'In vigore dal 19 aprile 1942' });
        expect(screen.getByText('In vigore dal 19/4/1942')).toHaveClass('md:hidden');
        expect(screen.getByText('In vigore dal 19 aprile 1942')).toHaveClass('hidden', 'md:inline');
        expect(button).toContainElement(screen.getByText('In vigore dal 19/4/1942'));
    });
});
