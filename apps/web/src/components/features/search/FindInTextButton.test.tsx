import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FindInTextButton } from './FindInTextButton';

/** The magnifier as a toolbar holds it: pressed while `open`, which the test changes as a practice switch would. */
function Harness({ onToggle, start = false }: { onToggle: (wasPressed: boolean) => void; start?: boolean }) {
    const [open, setOpen] = useState(start);
    return (
        <>
            <FindInTextButton isOpen={open} onToggle={onToggle} />
            <button type="button" onClick={() => setOpen((v) => !v)}>switch</button>
        </>
    );
}
const magnifier = () => screen.getByRole('button', { name: 'Cerca nel testo' });

describe('FindInTextButton', () => {
    it('is pressed while the window is open on its text', () => {
        render(<Harness onToggle={vi.fn()} start />);
        expect(magnifier()).toHaveAttribute('aria-pressed', 'true');
    });

    it('reads the state seen when the pointer went down, not the one a switch made before the click', () => {
        const onToggle = vi.fn();
        render(<Harness onToggle={onToggle} />);
        fireEvent.pointerDown(magnifier());
        // The practice switched on that press: the window is now open on this text.
        fireEvent.click(screen.getByRole('button', { name: 'switch' }));
        fireEvent.click(magnifier());
        expect(onToggle).toHaveBeenLastCalledWith(false);
    });

    it.each([
        ['released off the button', () => fireEvent.pointerUp(document.body)],
        ['cancelled', () => fireEvent.pointerCancel(magnifier())],
    ])('a press %s leaves nothing behind: Enter then reads the state on screen', async (_how, abort) => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(<Harness onToggle={onToggle} start />);
        fireEvent.pointerDown(magnifier());
        abort();
        // Closed since, from elsewhere.
        fireEvent.click(screen.getByRole('button', { name: 'switch' }));
        magnifier().focus();
        await user.keyboard('{Enter}');
        expect(onToggle).toHaveBeenLastCalledWith(false);
    });
});
