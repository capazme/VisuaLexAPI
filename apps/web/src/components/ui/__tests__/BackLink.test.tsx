import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { BackLink } from '../BackLink';

function Leaving({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <>
      <BackLink onBack={() => navigate(to)} />
      <h1 data-page-title="">Amministrazione</h1>
    </>
  );
}

/** Impostazioni as it comes back: it focuses its own title, and the part named by the anchor is drawn a moment later. */
function Settings() {
  const title = useRef<HTMLHeadingElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    title.current?.focus();
    const timer = setTimeout(() => setDrawn(true), 30);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <h1 ref={title} tabIndex={-1} data-page-title="">Impostazioni</h1>
      {drawn && (
        <section id="amministrazione">
          <h3>Amministrazione</h3>
        </section>
      )}
      <button type="button">Altro</button>
    </>
  );
}

function renderAt(to: string) {
  window.history.pushState({}, '', '/admin');
  render(
    <BrowserRouter>
      <main>
        <Routes>
          <Route path="/" element={<h1 data-page-title="">Ricerca</h1>} />
          <Route path="/impostazioni" element={<Settings />} />
          <Route path="/admin" element={<Leaving to={to} />} />
        </Routes>
      </main>
    </BrowserRouter>,
  );
}

afterEach(() => {
  // A click ends every landing still watched (3 s), so none reaches the next test.
  document.dispatchEvent(new Event('pointerdown'));
  window.history.pushState({}, '', '/');
});

describe('BackLink', () => {
  it('has Impostazioni\' look: 44 px on a phone, a background on hover', () => {
    renderAt('/');
    const back = screen.getByRole('button', { name: 'Indietro' });
    expect(back).toHaveClass('min-h-[44px]', 'md:min-h-0', 'rounded-lg', 'hover:bg-slate-100');
  });

  it('puts the focus on the title of the page reached', async () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    const title = await screen.findByRole('heading', { name: 'Ricerca' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  // Papiniano on #608: back to `/impostazioni#amministrazione` the focus was on the body.
  it('puts it on the heading of the part an anchor names, drawn after the page took the focus', async () => {
    renderAt('/impostazioni#amministrazione');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    const heading = await screen.findByRole('heading', { name: 'Amministrazione', level: 3 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('gives it back when the browser drops it to the body as the anchored part appears', async () => {
    renderAt('/impostazioni#amministrazione');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    const heading = await screen.findByRole('heading', { name: 'Amministrazione', level: 3 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // What Chrome does when it focuses an anchored part that is no control: the focus goes to nothing.
    act(() => heading.blur());
    expect(document.activeElement).toBe(document.body);
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('lets a focus moved out of the part stay there, after the heading had it', async () => {
    renderAt('/impostazioni#amministrazione');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    const heading = await screen.findByRole('heading', { name: 'Amministrazione', level: 3 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // Tab to a control out of the part, then the page changes: the focus stays where the reader put it.
    const other = screen.getByRole('button', { name: 'Altro' });
    act(() => other.focus());
    act(() => document.querySelector('main')!.append(document.createElement('div')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(other);
  });
});
