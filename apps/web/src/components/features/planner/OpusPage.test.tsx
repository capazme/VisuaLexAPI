import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpusPage } from './OpusPage';
import { plannerStore } from './plannerStore';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/work" element={<OpusPage />}>
          <Route path="*" element={<p>vista</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// LC8: the planner's three views are tabs of Work's page, since the bar lists only Work's five entries (D-315).
describe('Work\'s page', () => {
  it.each([
    ['/work/scadenziario', 'Scadenziario'],
    ['/work/prossimi', 'Prossimi giorni'],
    ['/work/ingresso', "Lista d'ingresso"],
  ])('on %s shows the three views as tabs, «%s» marked', (path, current) => {
    renderAt(path);
    const views = screen.getByRole('navigation', { name: 'Viste di Work' });
    const links = [...views.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/work/scadenziario', '/work/prossimi', '/work/ingresso']);
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.querySelector('.hidden.md\\:inline')?.textContent)).toEqual([current]);
    expect(screen.getByRole('link', { name: 'Cestino dei compiti' })).toBeInTheDocument();
  });

  it.each(['/work/scadenziario', '/work/prossimi', '/work/ingresso'])('on %s says «Scadenze» once, the tabs beside it in the one header (LC83)', (path) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Scadenze$/);
    expect(screen.getAllByText('Scadenze')).toHaveLength(1);
    const header = screen.getByRole('banner');
    expect(header).toContainElement(screen.getByRole('navigation', { name: 'Viste di Work' }));
    expect(header).toContainElement(screen.getByRole('link', { name: 'Cestino dei compiti' }));
    // Nothing fixed over the list: on a phone the tabs are the bar at the foot, outside the view.
    const fixed = [...document.querySelectorAll('[class*="max-md:fixed"], [class~="fixed"]')];
    expect(fixed).toHaveLength(1);
    expect(fixed[0]).toHaveClass('max-md:bottom-0');
    expect(screen.getByText('vista').closest('[class*="fixed"]')).toBeNull();
  });

  it('gives each tab one name per width, the other not drawn, so a screen reader reads one (LC83)', () => {
    renderAt('/work/prossimi');
    for (const link of screen.getByRole('navigation', { name: 'Viste di Work' }).querySelectorAll('a')) {
      expect(link).not.toHaveAttribute('aria-label');
      const names = [...link.querySelectorAll('span')].filter((span) => !span.children.length && !span.classList.contains('sr-only'));
      expect(names.map((span) => span.className)).toEqual(['md:hidden', 'hidden md:inline']);
    }
  });

  it.each(['/work/scadenziario', '/work/prossimi', '/work/ingresso'])('on %s has no «Raggruppa» in the header: it is a toggle in «Scadenziario» (LC91)', (path) => {
    renderAt(path);
    expect(screen.queryByRole('button', { name: /Raggruppa/ })).toBeNull();
  });

  it("counts the inbox on its tab while it is open", () => {
    act(() => plannerStore.getState().setInboxCount(4));
    renderAt('/work/ingresso');
    const tab = screen.getByRole('link', { name: /Lista d'ingresso/ });
    expect(tab).toHaveTextContent("Lista d'ingresso, 4 compiti");
    act(() => plannerStore.getState().setInboxCount(null));
  });

  it('on the trash shows the tabs, a way back, none marked, and no link to the trash itself', () => {
    renderAt('/work/cestino');
    const views = screen.getByRole('navigation', { name: 'Viste di Work' });
    expect([...views.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/work/scadenziario', '/work/prossimi', '/work/ingresso']);
    expect(views.querySelector('[aria-current]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cestino dei compiti' })).toBeNull();
  });

  it.each(['/work/pseudonimizzatore', '/work/grafo-pratiche'])('on %s shows neither the tabs nor the trash', (path) => {
    renderAt(path);
    expect(screen.queryByRole('navigation', { name: 'Viste di Work' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cestino dei compiti' })).toBeNull();
  });
});
