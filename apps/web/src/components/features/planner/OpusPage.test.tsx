import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpusPage } from './OpusPage';

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
    ['/work/oggi', 'Oggi'],
    ['/work/prossimi', 'Prossimi giorni'],
    ['/work/ingresso', "Lista d'ingresso"],
  ])('on %s shows the three views as tabs, «%s» marked', (path, current) => {
    renderAt(path);
    const views = screen.getByRole('navigation', { name: 'Viste di Work' });
    const links = [...views.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/work/oggi', '/work/prossimi', '/work/ingresso']);
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('aria-label'))).toEqual([current]);
    expect(screen.getByRole('link', { name: 'Cestino dei compiti' })).toBeInTheDocument();
  });

  it('on the trash shows the tabs, a way back, none marked, and no link to the trash itself', () => {
    renderAt('/work/cestino');
    const views = screen.getByRole('navigation', { name: 'Viste di Work' });
    expect([...views.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/work/oggi', '/work/prossimi', '/work/ingresso']);
    expect(views.querySelector('[aria-current]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cestino dei compiti' })).toBeNull();
  });

  it.each(['/work/anonimizzatore'])('on %s shows neither the tabs nor the trash', (path) => {
    renderAt(path);
    expect(screen.queryByRole('navigation', { name: 'Viste di Work' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cestino dei compiti' })).toBeNull();
  });
});
