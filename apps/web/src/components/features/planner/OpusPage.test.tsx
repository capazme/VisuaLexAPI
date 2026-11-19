import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpusPage } from './OpusPage';
import { plannerStore } from './plannerStore';
import { CONTROL_HEIGHT } from '../../ui/controlStyles';

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

  it.each(['/work/scadenziario', '/work/prossimi', '/work/ingresso'])('on %s says «Attività» once, the tabs under it in the one header (LC83, LC130)', (path) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Attività$/);
    expect(screen.getAllByText('Attività')).toHaveLength(1);
    const header = screen.getByRole('banner');
    expect(header).toContainElement(screen.getByRole('navigation', { name: 'Viste di Work' }));
    // From md the views are a row of their own, under the title and the trash (LC130).
    expect(header).toHaveClass('md:flex-wrap');
    expect(screen.getByRole('navigation', { name: 'Viste di Work' }).closest('.md\\:basis-full')).toHaveClass('md:order-last');
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
      const names = [...link.querySelectorAll('span')].filter((span) => !span.children.length && !span.classList.contains('sr-only') && !span.hasAttribute('data-segmented-mark'));
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

  // LC110: the common sizes — the tabs as `SegmentedTabs size="sm"` (44 px on a phone, 36 from md, 4 px corners), the
  // trash `Button`'s height, and on a phone the bar at the foot with an icon over each word.
  it('draws the tabs and the trash at the common sizes, the tabs a bar at the foot on a phone', () => {
    renderAt('/work/prossimi');
    const views = screen.getByRole('navigation', { name: 'Viste di Work' });
    expect(views).toHaveClass('md:p-0.5', 'rounded-md', 'max-md:bg-transparent');
    for (const link of views.querySelectorAll('a')) {
      expect(link).toHaveClass('min-h-11', 'md:min-h-8', 'rounded-md', 'max-md:min-h-11', 'max-md:flex-1');
      expect(link.querySelector('svg')!.parentElement).toHaveClass('md:hidden');
    }
    expect(views.closest('.max-md\\:fixed')).toHaveClass('max-md:bottom-0');
    expect(screen.getByRole('link', { name: 'Cestino dei compiti' })).toHaveClass(...CONTROL_HEIGHT.md.split(' '), 'rounded-md');
  });

  // LC111 (the consultant): the views' words at 13 px from md, as the section tabs; 12 under the icons on a phone.
  it('writes the views at 13 px on a computer and at 12 under the icons of the bar at the foot', () => {
    renderAt('/work/scadenziario');
    for (const link of screen.getByRole('navigation', { name: 'Viste di Work' }).querySelectorAll('a')) {
      expect(link).toHaveClass('md:text-[13px]', 'max-md:text-xs');
    }
  });
});
