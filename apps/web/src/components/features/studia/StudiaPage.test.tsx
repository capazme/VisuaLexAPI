import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StudiaPage } from './StudiaPage';

describe('StudiaPage', () => {
  it('lets the heading start to the right of the layout’s menu button, and adds no padding of its own', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/studia/schede']}>
        <Routes>
          <Route path="/studia" element={<StudiaPage />}>
            <Route path="schede" element={<p>vista</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex Studia' })).toHaveClass('pl-12', 'lg:pl-0');
    expect(container.firstElementChild?.className).not.toMatch(/\bp[xy]?-\d|md:p-\d/);
    expect(screen.getByRole('link', { name: 'Le mie schede' })).toBeInTheDocument();
    expect(screen.getByText('vista')).toBeInTheDocument();
  });
});
