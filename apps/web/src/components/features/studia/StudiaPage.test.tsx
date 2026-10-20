import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isValidator: false }) }));
vi.mock('../../../services/studiaService', () => ({
  studiaService: { progress: vi.fn(() => new Promise(() => {})), preferences: vi.fn(() => new Promise(() => {})) },
}));

import { Z_INDEX } from '../../../constants/zIndex';
import { StudiaPage } from './StudiaPage';

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studia" element={<StudiaPage />}>
          <Route path="ripasso" element={<p>oggi</p>} />
          <Route path="ripasso/sessione" element={<p>sessione</p>} />
          <Route path="progressi" element={<p>progressi</p>} />
          <Route path="schede" element={<p>vista</p>} />
          <Route path="schede/:id" element={<p>scheda</p>} />
          <Route path="valida" element={<p>coda</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudiaPage', () => {
  it('heads the view with the section name, leaving its links to the sidebar and the menu button to the layout', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/studia/schede']}>
        <Routes>
          <Route path="/studia" element={<StudiaPage />}>
            <Route path="schede" element={<p>vista</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // The layout starts the page under its menu button: the heading needs no step aside.
    expect(screen.getByRole('heading', { level: 1, name: 'Gymnasium: la tua palestra giuridica' }).className).not.toMatch(/\bpl-/);
    expect(container.firstElementChild?.className).not.toMatch(/\bp[xy]?-\d|md:p-\d/);
    // Ripasso, Le mie schede and Da validare are the sidebar's entries now (sections spec S6).
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('vista')).toBeInTheDocument();
  });

  it.each(['/studia/schede', '/studia/schede/k1', '/studia/valida'])('shows the strip, with its gear, over %s (Gymnasium spec §5.1)', (path) => {
    at(path);
    expect(screen.getByRole('button', { name: 'Impostazioni dello studio' })).toBeInTheDocument();
  });

  it.each(['/studia/ripasso', '/studia/progressi'])('centres %s as one column, the heading and its rule at the column\'s width; the other views keep theirs', (path) => {
    const { container, unmount } = at(path);
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveClass('mx-auto', 'max-w-3xl');
    expect(page).toContainElement(screen.getByRole('heading', { level: 1, name: 'Gymnasium: la tua palestra giuridica' }));
    unmount();
    const view = at('/studia/schede');
    expect(view.container.firstElementChild).toHaveClass('mx-auto', 'max-w-6xl');
    view.unmount();
  });

  it('draws the session as the lesson, a screen of its own over the shell, with no heading of the area (Gymnasium spec §5.4)', () => {
    const { container } = at('/studia/ripasso/sessione');
    const frame = screen.getByTestId('lesson-frame');
    // Portalled out of the page, in its own band: over the sidebar and the floating buttons, under the overlays.
    expect(container).not.toContainElement(frame);
    expect(frame.parentElement).toBe(document.body);
    expect(frame).toHaveClass('fixed', 'inset-0', Z_INDEX.lesson);
    expect(frame).toHaveTextContent('sessione');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it.each(['/studia/ripasso', '/studia/progressi', '/studia/ripasso/sessione'])('leaves %s alone: «Oggi» and «Progressi» draw their own summary, the session is a lesson', (path) => {
    at(path);
    expect(screen.queryByRole('button', { name: 'Impostazioni dello studio' })).toBeNull();
  });
});
