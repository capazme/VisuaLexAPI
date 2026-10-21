// The Scrivania on a phone (M1): no keyboard shortcut on a touch screen, the examples as pills in one sideways row,
// the page's 16 px margin, the block centred when it is shorter than the window.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { appStore } from '../../../store/useAppStore';
import { HIDDEN_SCROLLBAR } from '../../../constants/interactions';
import { Scrivania } from './Scrivania';

beforeEach(() => {
  appStore.setState({ dossiers: [], quickNorms: [] });
});

const renderPage = () => render(<MemoryRouter><Scrivania /></MemoryRouter>);

describe('the Scrivania on a phone', () => {
  it('drops «o premi ⌘K da qualsiasi pagina» on a touch screen', () => {
    renderPage();
    expect(screen.getByText('⌘K').parentElement).toHaveClass('[@media(pointer:coarse)]:hidden');
  });

  it('draws the examples as pills in one row that scrolls sideways, with no bar, and in a line from md', () => {
    renderPage();
    const row = screen.getByRole('group', { name: 'Esempi di ricerca' });
    expect(row).toHaveClass('overflow-x-auto', 'md:flex-wrap', 'max-md:-mx-4', 'max-md:px-4', 'max-md:py-1', ...HIDDEN_SCROLLBAR.split(' '));
    expect(row).not.toHaveClass('flex-wrap');
    const pills = within(row).getAllByRole('button');
    expect(pills.map((p) => p.textContent)).toEqual(['Art. 2043 c.c.', 'Art. 5 GDPR', 'Art. 1 Costituzione']);
    for (const pill of pills) expect(pill).toHaveClass('shrink-0', 'whitespace-nowrap', 'max-md:rounded-full', 'max-md:border', 'min-h-[44px]');
  });

  it('keeps the page\'s 16 px margin and centres the block in the window under the search bar', () => {
    const { container } = renderPage();
    expect(container.firstElementChild).toHaveClass(
      'max-md:-mx-4', 'max-md:w-auto', 'max-md:px-0', 'max-md:flex', 'max-md:flex-col', 'max-md:justify-center',
      'max-md:min-h-[calc(100dvh-var(--search-bar-height,0px)-2rem)]',
    );
  });

  it('takes Focus mode\'s padding off instead, where no search bar is drawn', () => {
    appStore.setState((s) => ({ settings: { ...s.settings, focusMode: true } }));
    try {
      const { container } = renderPage();
      expect(container.firstElementChild).toHaveClass('max-md:min-h-[calc(100dvh-6rem)]');
    } finally {
      appStore.setState((s) => ({ settings: { ...s.settings, focusMode: false } }));
    }
  });
});
