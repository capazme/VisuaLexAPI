import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionStatusChip } from './VersionStatusChip';
import type { VersionChip } from '../../../utils/versionDisplay';

const chip = (over: Partial<VersionChip> = {}): VersionChip => ({
    tone: 'historical',
    label: 'Testo storico · dal 25-12-2003 al 29-12-2007',
    title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale. Versione n. 7.',
    ...over,
});

describe('VersionStatusChip', () => {
    it('states the window and carries the source note as its tooltip', () => {
        render(<VersionStatusChip chip={chip()} onClick={() => {}} />);
        const button = screen.getByRole('button', { name: 'Testo storico · dal 25-12-2003 al 29-12-2007' });
        expect(button).toHaveAttribute('title', expect.stringContaining('fa fede la Gazzetta Ufficiale'));
        expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('opens the date dialog when pressed', () => {
        const onClick = vi.fn();
        render(<VersionStatusChip chip={chip({ tone: 'current', label: 'In vigore dal 28-12-2025' })} onClick={onClick} />);
        fireEvent.click(screen.getByRole('button', { name: 'In vigore dal 28-12-2025' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['current', 'emerald'],
        ['historical', 'amber'],
        ['abrogated', 'rose'],
        ['not_yet', 'slate'],
    ] as const)('colours the %s state apart from the others (%s)', (tone, colour) => {
        render(<VersionStatusChip chip={chip({ tone, label: tone })} onClick={() => {}} />);
        expect(screen.getByRole('button', { name: tone }).className).toContain(colour);
    });
});
