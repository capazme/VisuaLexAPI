import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const prepared = vi.hoisted(() => vi.fn());
vi.mock('../../pageCode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pageCode')>()),
  preparePage: prepared,
}));

import { SectionTabs } from './SectionTabs';

describe('the section tabs (LC21)', () => {
  it('ask for the home\'s code as a tab is pointed at, pressed or focused, so Learn\'s title comes with the change (LC133)', () => {
    render(
      <MemoryRouter initialEntries={['/work/scadenziario']}>
        <SectionTabs forumCount={0} />
      </MemoryRouter>,
    );
    const learn = screen.getByRole('button', { name: 'Learn' });
    fireEvent.pointerEnter(learn);
    expect(prepared).toHaveBeenLastCalledWith('/learn/ripasso');
    fireEvent.pointerDown(learn);
    fireEvent.focus(learn);
    expect(prepared).toHaveBeenCalledTimes(3);
  });
});
