import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LessonFrame } from './LessonFrame';

function renderFrame() {
  return render(
    <>
      <button type="button">Nella barra laterale</button>
      <LessonFrame>
        <button type="button">Interrompi</button>
        <button type="button">Mostra risposta</button>
      </LessonFrame>
    </>,
  );
}

describe('LessonFrame', () => {
  it('keeps Tab inside the lesson: past the last control to the first, before the first to the last', () => {
    renderFrame();
    const first = screen.getByRole('button', { name: 'Interrompi' });
    const last = screen.getByRole('button', { name: 'Mostra risposta' });
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone between its own controls', () => {
    renderFrame();
    const first = screen.getByRole('button', { name: 'Interrompi' });
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
  });

  it('brings a Tab from the shell behind it into the lesson', () => {
    renderFrame();
    const behind = screen.getByRole('button', { name: 'Nella barra laterale' });
    behind.focus();
    fireEvent.keyDown(behind, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Interrompi' }));
  });

  it('leaves the focus to a dialog open over it', () => {
    renderFrame();
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    const inside = document.createElement('button');
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    inside.focus();
    expect(fireEvent.keyDown(inside, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(inside);
    dialog.remove();
  });
});
