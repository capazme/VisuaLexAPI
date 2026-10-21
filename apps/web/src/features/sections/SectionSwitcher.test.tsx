import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const account = vi.hoisted(() => ({ devMode: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ devMode: account.devMode }) }));

import { SectionSwitcher } from './SectionSwitcher';
import { sectionStore } from './useSection';
import { SECTION_HOME_CODE } from './sections';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderSwitcher(path = '/', forumCount = 0, onChoose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <SectionSwitcher forumCount={forumCount} onChoose={onChoose} />
    </MemoryRouter>,
  );
  return onChoose;
}

const trigger = () => screen.getByRole('button', { name: /^Sezione:/ });

beforeEach(() => {
  account.devMode = false;
  sectionStore.setState({ section: 'opus' });
});

describe('SectionSwitcher (spec S3)', () => {
  it('names the active section on its button', () => {
    renderSwitcher('/studia/schede');
    expect(trigger()).toHaveAccessibleName('Sezione: Gymnasium, cambia sezione');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('lists the sections with their lines, the active one checked; Academia only in development mode', () => {
    renderSwitcher();
    fireEvent.click(trigger());
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      'VisuaLex OpusDossier di lavoro e strumenti per la professione',
      'VisuaLex GymnasiumSchede, ripasso, esami e concorsi',
      'VisuaLex ForumDossier pubblici e community',
    ]);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[1]).toHaveAttribute('aria-checked', 'false');
    expect(items[0]).toHaveFocus();
  });

  it('shows Academia with the development mode', () => {
    account.devMode = true;
    renderSwitcher();
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitemradio', { name: /VisuaLex Academia/ })).toBeInTheDocument();
  });

  it('moves by keyboard and closes with Esc, focus back on the button', () => {
    renderSwitcher();
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    const menu = screen.getByRole('menu');
    expect(screen.getByRole('menuitemradio', { name: /Forum/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitemradio', { name: /Opus/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: /Gymnasium/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("goes to the chosen section's page and tells the phone's menu to close (S4)", () => {
    const onChoose = renderSwitcher('/dossier');
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Gymnasium/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso');
    expect(onChoose).toHaveBeenCalledOnce();
    expect(trigger()).toHaveAccessibleName('Sezione: Gymnasium, cambia sezione');
  });

  it('says the Forum has news outside it: a dot on the icon, the count on its entry (S5)', () => {
    renderSwitcher('/', 3);
    expect(trigger()).toHaveAccessibleName('Sezione: Opus, cambia sezione, nuove attività nel Forum');
    expect(screen.getByTestId('forum-dot')).toBeInTheDocument();
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitemradio', { name: /Forum.*3 notifiche/ })).toBeInTheDocument();
  });

  it('takes the focus to the new section\'s title, as the page changes (S2)', async () => {
    render(
      <MemoryRouter initialEntries={['/dossier']}>
        <SectionSwitcher forumCount={0} />
        <main>
          <Routes>
            <Route path="/dossier" element={<h2 data-section-title="opus" tabIndex={-1}>I tuoi dossier di lavoro</h2>} />
            <Route path="/studia/ripasso" element={<h1 data-section-title="gymnasium" tabIndex={-1}>Gymnasium: la tua palestra giuridica</h1>} />
          </Routes>
        </main>
      </MemoryRouter>,
    );
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Gymnasium/ }), { detail: 0 });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gymnasium: la tua palestra giuridica' })).toHaveFocus());
    // From the keyboard the ring shows where the focus went.
    expect(screen.getByRole('heading', { name: 'Gymnasium: la tua palestra giuridica' })).not.toHaveAttribute('data-pointer-focus');
  });

  it('chosen with the mouse, the new title takes the focus without its ring (T1)', async () => {
    render(
      <MemoryRouter initialEntries={['/studia/ripasso']}>
        <SectionSwitcher forumCount={0} />
        <main>
          <Routes>
            <Route path="/studia/ripasso" element={<h1 data-section-title="gymnasium" tabIndex={-1}>Gymnasium: la tua palestra giuridica</h1>} />
            <Route path="/dossier" element={<h2 data-section-title="opus" tabIndex={-1}>I tuoi dossier di lavoro</h2>} />
          </Routes>
        </main>
      </MemoryRouter>,
    );
    fireEvent.click(trigger(), { detail: 1 });
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Opus/ }), { detail: 1 });
    const heading = await screen.findByRole('heading', { name: 'I tuoi dossier di lavoro' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('data-pointer-focus');
  });

  it('goes to the home of the section it is in without a change to show', () => {
    // The spy says whether a change asked the browser for a View Transition at all.
    const start = vi.fn((update: () => Promise<void>) => {
      const done = update();
      return { finished: Promise.resolve(), skipTransition: vi.fn(), ready: done, updateCallbackDone: done };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    try {
      renderSwitcher('/studia/schede');
      fireEvent.click(trigger());
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Gymnasium/ }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso');
      expect(start).not.toHaveBeenCalled();

      // Another section does ask for one.
      fireEvent.click(trigger());
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }));
      expect(start).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  it('in the phone\'s drawer asks for no View Transition: the drawer closing is the change (T1)', () => {
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    try {
      render(
        <MemoryRouter initialEntries={['/dossier']}>
          <Where />
          <SectionSwitcher forumCount={0} inDrawer />
        </MemoryRouter>,
      );
      fireEvent.click(trigger());
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }));
      expect(screen.getByTestId('where')).toHaveTextContent('/forum');
      expect(start).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  it('fetches the code of the other sections\' homes when it opens, so the change finds them there (T1)', () => {
    const gymnasium = vi.spyOn(SECTION_HOME_CODE, 'gymnasium').mockResolvedValue(undefined);
    renderSwitcher('/forum');
    expect(gymnasium).not.toHaveBeenCalled();
    fireEvent.click(trigger());
    expect(gymnasium).toHaveBeenCalledOnce();
    gymnasium.mockRestore();
  });

  it('changes the mark\'s colour in 200 ms, stilled under reduced motion (T1)', () => {
    renderSwitcher('/forum');
    const mark = trigger().querySelector('.vlx-section-mark');
    expect(mark).toHaveAttribute('data-section', 'forum');
    expect(mark).toHaveClass('transition-colors', 'duration-200', 'motion-reduce:transition-none');
  });

  it('draws no dot inside the Forum, where its own entry counts', () => {
    renderSwitcher('/forum', 3);
    expect(trigger()).toHaveAccessibleName('Sezione: Forum, cambia sezione');
    expect(screen.queryByTestId('forum-dot')).toBeNull();
  });

  describe('as a split button, where it has its name (S6)', () => {
    function renderSplit(path = '/studia/schede', { forumCount = 0, inDrawer = false } = {}) {
      const onChoose = vi.fn();
      render(
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <SectionSwitcher forumCount={forumCount} onChoose={onChoose} withName inDrawer={inDrawer} />
          <button type="button">altrove</button>
        </MemoryRouter>,
      );
      return onChoose;
    }
    const goHome = () => screen.getByRole('button', { name: /^Vai a/ });
    const arrow = () => screen.getByRole('button', { name: /^Cambia sezione/ });

    it('has two parts: the section, which goes to its home, and the arrow, which opens the menu', () => {
      renderSplit();
      expect(goHome()).toHaveAccessibleName('Vai a Gymnasium: Oggi');
      expect(goHome()).not.toHaveAttribute('aria-haspopup');
      expect(arrow()).toHaveAccessibleName('Cambia sezione');
      expect(arrow()).toHaveAttribute('aria-haspopup', 'menu');
      expect(arrow()).toHaveAttribute('aria-expanded', 'false');
    });

    it("the left part goes to the section's home and opens no menu", () => {
      const onChoose = renderSplit('/studia/schede');
      fireEvent.click(goHome(), { detail: 1 });
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(onChoose).toHaveBeenCalledOnce();
    });

    it('names Academia with its article and the Forum\'s news on the arrow', () => {
      account.devMode = true;
      renderSplit('/merlt', { forumCount: 2 });
      expect(goHome()).toHaveAccessibleName('Vai ad Academia: Assistente');
      expect(arrow()).toHaveAccessibleName('Cambia sezione, nuove attività nel Forum');
      expect(screen.getByTestId('forum-dot')).toBeInTheDocument();
    });

    it('works from the keyboard: arrows open and move, Home and End, Enter chooses, Esc and Tab close', () => {
      renderSplit('/dossier');
      fireEvent.keyDown(arrow(), { key: 'ArrowDown' });
      const menu = screen.getByRole('menu');
      expect(arrow()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menuitemradio', { name: /Opus/ })).toHaveFocus();
      fireEvent.keyDown(menu, { key: 'End' });
      expect(screen.getByRole('menuitemradio', { name: /Forum/ })).toHaveFocus();
      fireEvent.keyDown(menu, { key: 'Home' });
      expect(screen.getByRole('menuitemradio', { name: /Opus/ })).toHaveFocus();
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(screen.getByRole('menuitemradio', { name: /Forum/ })).toHaveFocus();
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(arrow()).toHaveFocus();

      fireEvent.keyDown(arrow(), { key: 'ArrowUp' });
      expect(screen.getByRole('menuitemradio', { name: /Forum/ })).toHaveFocus();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
      expect(screen.queryByRole('menu')).toBeNull();

      // Enter on an entry is its click, with `detail` 0.
      fireEvent.keyDown(arrow(), { key: 'ArrowDown' });
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Gymnasium/ }), { detail: 0 });
      expect(screen.getByTestId('where')).toHaveTextContent('/studia/ripasso');
      expect(arrow()).toHaveFocus();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('draws one check, on the section chosen at once, and closes by itself a moment after the choice', async () => {
      // With the Web Animations API (stubbed: each animation ends at once) the menu stays for the check to arrive.
      const animate = vi.fn(function (this: Element) {
        const finish: (() => void)[] = [];
        queueMicrotask(() => finish.forEach((f) => f()));
        return { cancel: vi.fn(), finished: Promise.resolve(), addEventListener: (_: string, f: () => void) => finish.push(f) };
      });
      Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
      try {
        renderSplit('/dossier');
        fireEvent.click(arrow());
        expect(screen.getAllByTestId('section-check')).toHaveLength(1);
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }), { detail: 1 });
        // Chosen: the check is there, nothing more can be chosen, the arrow says the menu is going.
        expect(screen.getByRole('menuitemradio', { name: /Forum/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('menuitemradio', { name: /Opus/ })).toHaveAttribute('aria-checked', 'false');
        expect(arrow()).toHaveAttribute('aria-expanded', 'false');
        // Nothing more can be chosen in it while it goes.
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Gymnasium/ }), { detail: 1 });
        expect(screen.getByTestId('where')).toHaveTextContent('/forum');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull(), { timeout: 2000 });
        expect(goHome()).toHaveAccessibleName('Vai a Forum: Dossier pubblici');
      } finally {
        delete (Element.prototype as Partial<Element>).animate;
      }
    });

    it('under reduced motion, or with no Web Animations, closes at once after the choice', () => {
      renderSplit('/dossier');
      fireEvent.click(arrow());
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }), { detail: 1 });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(arrow()).toHaveFocus();
    });

    it('a click outside closes it; a click on the arrow or in the menu does not count as outside', () => {
      renderSplit('/dossier');
      fireEvent.click(arrow());
      fireEvent.mouseDown(screen.getByRole('menu'));
      fireEvent.mouseDown(arrow());
      expect(screen.getByRole('menu')).toBeInTheDocument();
      // The arrow's own click closes it.
      fireEvent.click(arrow());
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.click(arrow());
      fireEvent.mouseDown(screen.getByRole('button', { name: 'altrove' }));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it("in the phone's drawer goes at once with the choice: the drawer closing is the change (T1)", () => {
      Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve(), addEventListener: vi.fn() })) as unknown as typeof Element.prototype.animate;
      try {
        const onChoose = renderSplit('/dossier', { inDrawer: true });
        fireEvent.click(arrow());
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Forum/ }), { detail: 1 });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(onChoose).toHaveBeenCalledOnce();
      } finally {
        delete (Element.prototype as Partial<Element>).animate;
      }
    });

    it("in the phone's drawer is as wide as the drawer less 32 px, with entries of 56 px", () => {
      renderSplit('/dossier', { inDrawer: true });
      fireEvent.click(arrow());
      expect(screen.getByRole('menu')).toHaveClass('w-[calc(100%-12px)]', 'left-1.5');
      expect(screen.getByRole('menuitemradio', { name: /Opus/ })).toHaveClass('min-h-14');
    });
  });
});
