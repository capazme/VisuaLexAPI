import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { CreditEntry, CreditsPage } from '../CreditsPage';
import { groupAt } from '../creditsIndex';
import { CREDITS, CREDIT_GROUPS, type Credit } from '../../data/credits';

const scrolled: Element[] = [];

beforeEach(() => {
  scrolled.length = 0;
  // jsdom draws nothing, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CreditsPage />
    </MemoryRouter>,
  );
}

describe('CreditsPage', () => {
  it('is titled «Crediti», with one section per group in order', () => {
    renderAt('/crediti');
    expect(screen.getByRole('heading', { level: 1, name: 'Crediti' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(CREDIT_GROUPS.map((g) => g.title));
  });

  it.each(CREDITS.map((c) => [c.id, c] as const))('draws %s in its group, under its anchor, with its line verbatim', (id, credit) => {
    renderAt('/crediti');
    const article = document.getElementById(id)!;
    expect(article).not.toBeNull();
    expect(article.tagName).toBe('ARTICLE');
    expect(within(article).getByRole('heading', { level: 3 }).textContent).toBe(credit.name);
    expect(article.querySelector('[data-attribution]')!.textContent).toBe(credit.attribution);
    expect(article).toHaveTextContent(credit.uses);
    expect(article).toHaveTextContent(credit.terms);

    const title = CREDIT_GROUPS.find((g) => g.id === credit.group)!.title;
    expect(screen.getByRole('region', { name: title })).toContainElement(article);

    const links = within(article).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([credit.sourceUrl, ...(credit.licenceUrl ? [credit.licenceUrl] : [])]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(within(article).getByRole('link', { name: `Sito della fonte di ${credit.name} (si apre in una nuova scheda)` })).toBeInTheDocument();
  });

  it.each(['corte-costituzionale', 'consob', 'geist'])('brings the address #%s to its entry and focuses it', (id) => {
    renderAt(`/crediti#${id}`);
    const article = document.getElementById(id)!;
    expect(scrolled).toEqual([article]);
    expect(article).toHaveFocus();
    expect(article).toHaveAccessibleName(CREDITS.find((c) => c.id === id)!.name);
  });

  it.each(['/crediti', '/crediti#gazzetta-ufficiale', '/crediti#%'])('moves nothing and still draws the page at %s', (path) => {
    renderAt(path);
    expect(scrolled).toEqual([]);
    expect(screen.getByRole('heading', { level: 1, name: 'Crediti' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
  });

  it('leads back to VisuaLex', () => {
    renderAt('/crediti');
    expect(screen.getByRole('link', { name: 'VisuaLex' })).toHaveAttribute('href', '/');
  });
});

// The worst case a future entry could bring (break-ui): a long name and holder, an attribution and terms with
// an address in them, which has no place to break. jsdom lays nothing out, so this holds the rule that makes
// them wrap at 390 px — every text of the entry breaks anywhere — and that nothing is cut.
const WORST: Credit = {
  id: 'worst-case',
  group: 'giurisprudenza',
  name: 'Corte suprema di cassazione, Centro elettronico di documentazione (CED): SentenzeWeb e Italgiure Web',
  holder: 'Ministero dell’economia e delle finanze, Dipartimento delle Finanze, Centro di ricerca e documentazione economica e finanziaria',
  uses: 'Le sentenze tributarie.',
  terms: 'Testo della licenza: https://creativecommons.org/licenses/by-sa/3.0/legalcode.it#Sezione4-Restrizioni',
  attribution:
    'Fonte: Corte costituzionale, dati aperti, CC BY-SA 3.0 — https://dati.cortecostituzionale.it/ProntuarioDatiAperti/Pronunce/Massime/2026',
  sourceUrl: 'https://www.italgiure.giustizia.it/sncass/',
  verified: 'fixture',
};

describe('CreditEntry — the worst case', () => {
  it('shows every long text whole and lets each of them break', () => {
    render(<CreditEntry credit={WORST} />);
    const article = document.getElementById('worst-case')!;
    const name = within(article).getByRole('heading', { level: 3 });
    expect(name.textContent).toBe(WORST.name);
    expect(article.querySelector('[data-attribution]')!.textContent).toBe(WORST.attribution);
    expect(article).toHaveTextContent(WORST.holder);
    expect(article).toHaveTextContent(WORST.terms);
    const holder = within(article).getByText(WORST.holder);
    for (const el of [name, holder, article.querySelector('dl')!]) {
      expect(el.className).toContain('[overflow-wrap:anywhere]');
      expect(el.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    }
  });
});

// A page to consult (U1d): the frame's whole width, an index of the groups, the sources as cards.
describe('CreditsPage — laid out for consulting', () => {
  it('lists the groups in an index, in order, one marked as the place being read', () => {
    renderAt('/crediti');
    const index = screen.getByRole('navigation', { name: 'In questa pagina' });
    const links = within(index).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(CREDIT_GROUPS.map((group) => group.title));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(CREDIT_GROUPS.map((group) => `/crediti#${group.id}`));
    // One place marked at a time (jsdom lays nothing out: which one is `groupAt`'s, tested below).
    expect(links.filter((link) => link.getAttribute('aria-current') === 'location')).toHaveLength(1);
    for (const link of links) expect(link).toHaveClass('min-h-[44px]');
    // A row of its own on a phone, scrolling inside its band; a column beside the sources from 1024 px.
    expect(within(index).getByRole('list')).toHaveClass('overflow-x-auto', 'lg:flex-col');
  });

  it('brings a group from the index to its section, and focuses it, again when its item is pressed again', async () => {
    renderAt('/crediti');
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Giurisprudenza' }));
    const section = document.getElementById('giurisprudenza')!;
    expect(scrolled).toEqual([section]);
    expect(section).toHaveFocus();
    expect(section).toHaveAccessibleName('Giurisprudenza');
    // Scrolled away, the same item brings it back.
    act(() => section.blur());
    await user.click(screen.getByRole('link', { name: 'Giurisprudenza' }));
    expect(scrolled).toEqual([section, section]);
    expect(section).toHaveFocus();
  });

  it('draws each source\'s words exactly as credits.ts holds them', () => {
    renderAt('/crediti');
    for (const credit of CREDITS) {
      const article = document.getElementById(credit.id)!;
      const values = [...article.querySelectorAll('dd')].map((dd) => dd.textContent);
      expect(values).toEqual([credit.uses, credit.terms, credit.attribution]);
    }
  });

  it('draws each source as a card, two a row from 1280 px, its links at its foot', () => {
    renderAt('/crediti');
    for (const group of CREDIT_GROUPS) {
      const section = screen.getByRole('region', { name: group.title });
      const grid = section.querySelector('article')!.parentElement!;
      expect(grid).toHaveClass('grid', 'xl:grid-cols-2');
    }
    const article = document.getElementById('normattiva')!;
    expect(article).toHaveClass('flex', 'h-full', 'flex-col');
    expect(article.querySelector('a')!.parentElement).toHaveClass('mt-auto');
    // No narrow column any more: the frame's whole width.
    expect(document.querySelector('.max-w-2xl')).toBeNull();
  });
});

// The index's mark follows the page's scroll (U1d).
describe('groupAt', () => {
  const tops = (...values: number[]) => values.map((top, i) => ({ id: ['norme', 'giurisprudenza', 'autorita', 'software'][i], top }));

  it('marks the last section whose top has passed the reading line', () => {
    expect(groupAt(tops(-900, -100, 350, 900), 1000, false)).toBe('giurisprudenza');
    expect(groupAt(tops(-900, -500, 290, 900), 1000, false)).toBe('autorita');
  });

  it('marks the first above the first section, and the last at the page\'s end', () => {
    expect(groupAt(tops(500, 1200, 1900, 2600), 1000, false)).toBe('norme');
    // A short last section never reaches the line on a tall window: the end marks it.
    expect(groupAt(tops(-2000, -1200, 100, 600), 1000, true)).toBe('software');
  });
});
