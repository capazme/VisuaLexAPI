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
    for (const pill of pills) expect(pill).toHaveClass('shrink-0', 'whitespace-nowrap', 'max-md:rounded-full', 'max-md:bg-ink-200/70', 'min-h-[44px]');
  });

  it('keeps the page\'s 16 px margin and starts under the field, not centred in the window (LC38)', () => {
    const { container } = renderPage();
    expect(container.firstElementChild).toHaveClass('max-md:w-auto', 'max-md:px-0', 'max-md:pt-6');
    expect(container.firstElementChild).not.toHaveClass('max-md:justify-center');
    // The reader's column has no padding below md since R3b: taking 16 px back would put the page on the screen's edges.
    expect(container.firstElementChild).not.toHaveClass('max-md:-mx-4');
  });

  it('has no second way to the search on a phone: the field is right above (LC38)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Inizia una ricerca' }).parentElement).toHaveClass('max-md:hidden');
  });
});

// LC8: Work's bar no longer lists the Corpus tools; the search page reaches them, at every width.
describe('the Scrivania\'s ways to the Corpus tools', () => {
  it('links «Analizza un documento» and «Rassegne», in the flow of the page (seen at 390 px too)', () => {
    renderPage();
    const tools = screen.getByRole('navigation', { name: 'Altri strumenti del Corpus' });
    const links = within(tools).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Analizza un documento', '/documents'], ['Rassegne', '/rassegne']]);
    // The links: underlined, in the action's ink (#448: they read as bold text).
    for (const link of links) expect(link).toHaveClass('min-h-[44px]', 'underline', 'decoration-primary-300', 'underline-offset-4', 'font-serif', 'text-primary-700');
    // LC21: the «Prova» examples are bold sans buttons, not underlined links.
    const example = screen.getByRole('button', { name: 'Art. 2043 c.c.' });
    expect(example).toHaveClass('font-semibold', 'min-h-[44px]');
    expect(example).not.toHaveClass('underline');
    expect(example).not.toHaveClass('font-serif');
    expect(tools.className).not.toMatch(/(^|\s)hidden(\s|$)|max-md:hidden/);
  });
});
