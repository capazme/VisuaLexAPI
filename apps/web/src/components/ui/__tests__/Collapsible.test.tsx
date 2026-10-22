import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Collapsible } from '../Collapsible';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motion.reduced,
}));

function Harness({ initiallyOpen = false, inside }: { initiallyOpen?: boolean; inside?: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls="dettagli" onClick={() => setOpen((v) => !v)}>
        Dettagli
      </button>
      <Collapsible id="dettagli" open={open} onClose={() => setOpen(false)} triggerRef={trigger} role="region" aria-label="Dettagli del compito">
        <label>
          Scadenza
          <input />
        </label>
        {inside}
      </Collapsible>
      <p>Sotto</p>
    </>
  );
}

const panel = () => document.getElementById('dettagli')!;

// «La tendina» (U1a): a panel that opens in place, by grid rows, and pushes what follows down.
describe('Collapsible', () => {
  it('is closed to a reader and to the keyboard until its trigger opens it', async () => {
    render(<Harness />);
    expect(screen.queryByRole('region', { name: 'Dettagli del compito' })).toBeNull();
    expect(panel()).toHaveAttribute('inert');
    expect(panel()).toHaveClass('grid-rows-[0fr]', 'invisible');
    await userEvent.click(screen.getByRole('button', { name: 'Dettagli' }));
    const region = screen.getByRole('region', { name: 'Dettagli del compito' });
    expect(region).not.toHaveAttribute('inert');
    expect(region).toHaveClass('grid-rows-[1fr]', 'duration-200');
    expect(region).not.toHaveClass('invisible');
    expect(screen.getByRole('button', { name: 'Dettagli' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('grows by its grid rows with no height in script, its content fading in just after; it closes faster', () => {
    const { rerender } = render(<Collapsible id="p" open={false}>x</Collapsible>);
    const outer = document.getElementById('p')!;
    expect(outer.style.height).toBe('');
    expect(outer).toHaveClass('transition-[grid-template-rows,visibility]', 'duration-150');
    expect(outer.firstElementChild).toHaveClass('min-h-0', 'overflow-hidden');
    expect(outer.firstElementChild!.firstElementChild).toHaveClass('opacity-0', 'duration-100');
    rerender(<Collapsible id="p" open>x</Collapsible>);
    expect(outer.firstElementChild!.firstElementChild).toHaveClass('opacity-100', 'delay-50', 'duration-150');
    // Under reduced motion the content never fades: no 150 ms of the global rule after the delay.
    expect(outer.firstElementChild!.firstElementChild).toHaveClass('motion-reduce:opacity-100', 'motion-reduce:delay-0');
  });

  it('lets its content overflow once still, never while the height moves', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dettagli' }));
    const inner = panel().firstElementChild!;
    expect(inner).toHaveClass('overflow-hidden');
    const end = new Event('transitionend', { bubbles: true });
    Object.defineProperty(end, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(panel(), end);
    expect(inner).toHaveClass('overflow-visible');
  });

  it('opens at once under reduced motion, its content free at once', () => {
    motion.reduced = true;
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Dettagli' }));
      expect(panel().firstElementChild).toHaveClass('overflow-visible');
    } finally {
      motion.reduced = false;
    }
  });

  it('closes on Esc inside it and gives the focus back to its trigger', async () => {
    render(<Harness initiallyOpen />);
    await userEvent.click(screen.getByLabelText('Scadenza'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Dettagli del compito' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dettagli' })).toHaveFocus();
  });

  it('takes no transitionend from inside it for its own', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dettagli' }));
    const end = new Event('transitionend', { bubbles: true });
    Object.defineProperty(end, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(screen.getByLabelText('Scadenza'), end);
    expect(panel().firstElementChild).toHaveClass('overflow-hidden');
  });

  it('opens again when reopened halfway through closing, visible at once', () => {
    render(<Harness initiallyOpen />);
    const trigger = screen.getByRole('button', { name: 'Dettagli' });
    fireEvent.click(trigger);
    expect(panel()).toHaveClass('invisible', 'transition-[grid-template-rows,visibility]');
    fireEvent.click(trigger);
    // Opening, visibility does not transition: a focus given in the next frame lands.
    expect(panel()).toHaveClass('grid-rows-[1fr]', 'transition-[grid-template-rows]');
    expect(panel()).not.toHaveClass('invisible');
    expect(screen.getByRole('region', { name: 'Dettagli del compito' })).toBeInTheDocument();
  });

  it('leaves an Esc that something inside handled, and one from a dialog portaled from inside it', async () => {
    function Dialog() {
      return createPortal(
        <div role="dialog" aria-label="Conferma">
          <button type="button">Annulla</button>
        </div>,
        document.body,
      );
    }
    render(<Harness initiallyOpen inside={<><input aria-label="Gestito" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} /><Dialog /></>} />);
    await userEvent.click(screen.getByLabelText('Gestito'));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: 'Dettagli del compito' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: 'Dettagli del compito' })).toBeInTheDocument();
  });

  it('frees its content after the longest transition even with no transitionend', async () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Dettagli' }));
      expect(panel().firstElementChild).toHaveClass('overflow-hidden');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(panel().firstElementChild).toHaveClass('overflow-visible');
    } finally {
      vi.useRealTimers();
    }
  });
});
