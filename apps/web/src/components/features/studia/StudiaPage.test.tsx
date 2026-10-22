import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useOutletContext } from 'react-router-dom';

const auth = vi.hoisted(() => ({ value: { isValidator: false, loading: false, user: { id: 'u1' } as { id: string } | null } }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('../../../services/studiaService', () => ({
  studiaService: { progress: vi.fn(() => new Promise(() => {})), preferences: vi.fn(() => new Promise(() => {})) },
}));

import { Z_INDEX } from '../../../constants/zIndex';
import { StudiaPage, type StudiaOutletContext } from './StudiaPage';
import { studiaService } from '../../../services/studiaService';

function Validator() {
  return <p data-testid="validator">{String(useOutletContext<StudiaOutletContext>().validator)}</p>;
}

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

describe('StudiaPage — what it tells its views about the account', () => {
  it.each([
    [{ isValidator: true, loading: false, user: { id: 'u1' } }, 'true'],
    [{ isValidator: false, loading: false, user: { id: 'u1' } }, 'false'],
    [{ isValidator: false, loading: true, user: null }, 'undefined'],
    // `/auth/me` failed: useAuth says isValidator false, which must not read as «not a validator».
    [{ isValidator: false, loading: false, user: null }, 'null'],
  ])('%o → validator %s', (value, expected) => {
    auth.value = value;
    render(
      <MemoryRouter initialEntries={['/studia/valida']}>
        <Routes>
          <Route path="/studia" element={<StudiaPage />}>
            <Route path="valida" element={<Validator />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('validator').textContent).toBe(expected);
    auth.value = { isValidator: false, loading: false, user: { id: 'u1' } };
  });
});

describe('StudiaPage', () => {
  it('heads the view with its name, leaving its links to the sidebar and the menu button to the layout', () => {
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
    expect(screen.getByRole('heading', { level: 1, name: 'Le mie schede' }).className).not.toMatch(/\bpl-/);
    expect(container.firstElementChild?.className).not.toMatch(/\bp[xy]?-\d|md:p-\d/);
    // Ripasso, Le mie schede and Da validare are the sidebar's entries now (sections spec S6).
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('vista')).toBeInTheDocument();
  });

  it.each([
    ['/studia/ripasso', 'Oggi'],
    ['/studia/progressi', 'Progressi'],
    ['/studia/schede', 'Le mie schede'],
    ['/studia/schede/k1', 'Le mie schede'],
    ['/studia/valida', 'Da validare'],
  ])('titles %s with the page\'s name, «Gymnasium · la tua palestra giuridica» small over it (L-37)', (path, name) => {
    at(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(new RegExp(`^${name}$`));
    expect(screen.getByText('Gymnasium · la tua palestra giuridica')).toBeInTheDocument();
  });

  it('gives «Le mie schede» a place for its action beside the title, and no other view', () => {
    function Slot() {
      const { actionSlot } = useOutletContext<StudiaOutletContext>();
      return <p data-testid="slot">{actionSlot ? 'slot' : 'none'}</p>;
    }
    const { unmount } = render(
      <MemoryRouter initialEntries={['/studia/schede']}>
        <Routes>
          <Route path="/studia" element={<StudiaPage />}>
            <Route path="schede" element={<Slot />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('slot')).toHaveTextContent('slot');
    // The slot is in the header, beside the title.
    expect(screen.getByRole('banner').querySelector('.contents')).not.toBeNull();
    unmount();
    render(
      <MemoryRouter initialEntries={['/studia/valida']}>
        <Routes>
          <Route path="/studia" element={<StudiaPage />}>
            <Route path="valida" element={<Slot />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('slot')).toHaveTextContent('none');
  });

  it('shows the strip, with its gear, over «Da validare» (Gymnasium spec §5.1)', () => {
    at('/studia/valida');
    expect(screen.getByRole('button', { name: 'Impostazioni dello studio' })).toBeInTheDocument();
  });

  it('opens the study settings in the strip, in place and never in a window, Esc giving the focus back to the gear (U1b)', async () => {
    vi.mocked(studiaService.preferences).mockResolvedValue({ ripassiAlGiorno: 20, nuoveAlGiorno: 10, materieComunita: [] } as never);
    at('/studia/valida');
    const user = userEvent.setup();
    const gear = screen.getByRole('button', { name: 'Impostazioni dello studio' });
    expect(gear).not.toHaveAttribute('aria-haspopup');
    expect(screen.queryByRole('region', { name: 'Impostazioni dello studio' })).toBeNull();
    await user.click(gear);
    expect(gear).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();
    const panel = screen.getByRole('region', { name: 'Impostazioni dello studio' });
    expect(gear).toHaveAttribute('aria-controls', panel.id);
    // In the strip, which grows downward with it.
    expect(gear.closest('[aria-busy]')).toContainElement(panel);
    // Esc in the community's subjects, one level down, closes only them, the focus back on their button.
    const community = await within(panel).findByRole('button', { name: /^Schede della comunità · / });
    await user.click(community);
    expect(community).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(within(panel).getAllByRole('switch')[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(community).toHaveAttribute('aria-expanded', 'false');
    expect(community).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Impostazioni dello studio' })).toBe(panel);
    // Esc from a field closes the settings, the focus back on the gear.
    await user.click(within(panel).getByLabelText('Ripassi al giorno'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Impostazioni dello studio' })).toBeNull();
    expect(gear).toHaveFocus();
    // The gear again opens and closes them.
    await user.click(gear);
    await user.click(gear);
    expect(gear).toHaveAttribute('aria-expanded', 'false');
  });

  it.each(['/studia/ripasso', '/studia/progressi', '/studia/schede', '/studia/valida'])('draws %s in the sections\' frame, the layout\'s full width with nothing narrower (G6, W2)', (path) => {
    const { container } = at(path);
    const page = container.firstElementChild as HTMLElement;
    expect(page.className).not.toMatch(/\bmax-w-|\bmx-auto\b/);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(page).toContainElement(heading);
    // The section switcher puts the focus on it.
    expect(heading).toHaveAttribute('data-section-title', 'gymnasium');
    expect(heading).toHaveAttribute('tabindex', '-1');
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

  it.each(['/studia/ripasso', '/studia/progressi', '/studia/schede', '/studia/schede/k1', '/studia/ripasso/sessione'])('leaves %s alone: «Oggi» and «Progressi» draw their own summary, «Le mie schede» none (G8), the session is a lesson', (path) => {
    at(path);
    expect(screen.queryByRole('button', { name: 'Impostazioni dello studio' })).toBeNull();
  });
});
