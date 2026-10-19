import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LessonFrame, LessonLoading } from './LessonFrame';

/** The app's shell lives in `#root`, as `main.tsx` mounts it. */
function renderFrame() {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return render(
    <>
      <button type="button">Nella barra laterale</button>
      <LessonFrame>
        <button type="button">Interrompi</button>
        <button type="button">Mostra risposta</button>
      </LessonFrame>
    </>,
    { container: root },
  );
}

afterEach(() => document.getElementById('root')?.remove());

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

  it('leaves Tab to a popover the article portals to the body, such as a note being typed', () => {
    renderFrame();
    const popover = document.createElement('div');
    const field = document.createElement('textarea');
    popover.appendChild(field);
    document.body.appendChild(popover);
    field.focus();
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(field);
    popover.remove();
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

describe('LessonLoading', () => {
  it('offers a way out while the session loads, by the button or Esc', async () => {
    const at = () =>
      render(
        <MemoryRouter initialEntries={['/studia/ripasso/sessione']}>
          <Routes>
            <Route path="/studia/ripasso" element={<p>Oggi</p>} />
            <Route path="/studia/ripasso/sessione" element={<LessonLoading />} />
          </Routes>
        </MemoryRouter>,
      );
    const first = at();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(await screen.findByText('Oggi')).toBeInTheDocument();
    first.unmount();
    at();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(await screen.findByText('Oggi')).toBeInTheDocument();
  });
});
