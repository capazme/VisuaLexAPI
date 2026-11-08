import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DossierItem } from '../../../types';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import { bringRowIntoView, citedArticleOf, keepLinkAt } from './citedNorm';

const norma = (id: string, data: Extract<DossierItem, { type: 'norma' }>['data']): DossierItem => ({ id, type: 'norma', addedAt: '', data });
const cite = (c: Partial<ParsedCitationData> & Pick<ParsedCitationData, 'act_type' | 'article'>): ParsedCitationData => ({ confidence: 0.95, ...c });

const ITEMS: DossierItem[] = [
  norma('cc2043', { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' }),
  norma('l241-3bis', { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '3-bis' }),
  norma('l241-21-old', { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '21', versione: 'originale' }),
  norma('l241-21', { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '21' }),
  norma('dlgs50-all1', { tipo_atto: 'decreto legislativo', numero_atto: '50', data: '2016-04-18', numero_articolo: '1', allegato: '1' }),
  norma('gdpr6', { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', numero_articolo: '6' }),
  { id: 'n1', type: 'note', addedAt: '', data: 'art. 2043 c.c.' },
];

describe('citedArticleOf', () => {
  it('finds a code’s article by the code’s name, whatever number and date the item carries', () => {
    expect(citedArticleOf(ITEMS, cite({ act_type: 'codice civile', article: '2043' }))?.id).toBe('cc2043');
    expect(citedArticleOf(ITEMS, cite({ act_type: 'Codice Civile', article: '2043' }))?.id).toBe('cc2043');
  });

  it('finds an act’s article by type, number and the year a citation gives of its date', () => {
    expect(citedArticleOf(ITEMS, cite({ act_type: 'legge', act_number: '241', date: '1990', article: '3-bis' }))?.id).toBe('l241-3bis');
    expect(citedArticleOf(ITEMS, cite({ act_type: 'regolamento ue', act_number: '679', date: '2016', article: '6' }))?.id).toBe('gdpr6');
  });

  it('reads the article’s number in any spelling', () => {
    expect(citedArticleOf(ITEMS, cite({ act_type: 'legge', act_number: '241', date: '1990', article: '3 bis' }))?.id).toBe('l241-3bis');
    expect(citedArticleOf(ITEMS, cite({ act_type: 'legge', act_number: '241', date: '1990', article: '3bis' }))?.id).toBe('l241-3bis');
  });

  it('opens the text in force before a past text of the same article', () => {
    expect(citedArticleOf(ITEMS, cite({ act_type: 'legge', act_number: '241', date: '1990', article: '21' }))?.id).toBe('l241-21');
    const pastOnly = ITEMS.filter((i) => i.id !== 'l241-21');
    expect(citedArticleOf(pastOnly, cite({ act_type: 'legge', act_number: '241', date: '1990', article: '21' }))?.id).toBe('l241-21-old');
  });

  it('reads a number or a year only where both sides give one: a code the page does not name, an entry with no date', () => {
    const items = [
      norma('cds141', { tipo_atto: 'codice della strada', numero_atto: '285', data: '1992-04-30', numero_articolo: '141' }),
      norma('nav1', { tipo_atto: 'codice della navigazione', data: '', numero_articolo: '1' }),
    ];
    // «art. 141 c.d.s.»: no number, no year; the entry added through MCP has both
    expect(citedArticleOf(items, cite({ act_type: 'codice della strada', article: '141' }))?.id).toBe('cds141');
    // the entry has no date, the citation a year
    expect(citedArticleOf(items, cite({ act_type: 'codice della navigazione', date: '1942', article: '1' }))?.id).toBe('nav1');
    // both give a number, and they differ
    expect(citedArticleOf(items, cite({ act_type: 'codice della strada', act_number: '286', article: '141' }))).toBeNull();
  });

  it('finds the implementing provisions of the codes, as the citation matcher names them', () => {
    const items = [
      norma('dacc23', { tipo_atto: "disposizioni per l'attuazione del codice civile e disposizioni transitorie", data: '1942-03-30', numero_articolo: '23' }),
    ];
    expect(citedArticleOf(items, cite({ act_type: "disposizioni per l'attuazione del Codice civile e disposizioni transitorie", article: '23' }))?.id).toBe('dacc23');
    expect(citedArticleOf(items, cite({ act_type: "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie", article: '23' }))).toBeNull();
  });

  it('holds nothing for another act, another year, another article, an annex’s article or a note’s words', () => {
    expect(citedArticleOf(ITEMS, cite({ act_type: 'codice penale', article: '2043' }))).toBeNull();
    expect(citedArticleOf(ITEMS, cite({ act_type: 'legge', act_number: '241', date: '1991', article: '21' }))).toBeNull();
    expect(citedArticleOf(ITEMS, cite({ act_type: 'legge', act_number: '242', date: '1990', article: '21' }))).toBeNull();
    expect(citedArticleOf(ITEMS, cite({ act_type: 'codice civile', article: '2044' }))).toBeNull();
    expect(citedArticleOf(ITEMS, cite({ act_type: 'decreto legislativo', act_number: '50', date: '2016', article: '1' }))).toBeNull();
    expect(citedArticleOf([], cite({ act_type: 'codice civile', article: '2043' }))).toBeNull();
  });
});

describe('bringRowIntoView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const rect = (top: number) => ({ top, bottom: top + 44, left: 0, right: 0, width: 0, height: 44, x: 0, y: top, toJSON: () => ({}) });

  // The page's scroller (scroll padding 64 px, the phone's bar) > the column > the row.
  function setup(columnOverflow: 'auto' | 'visible', rowTopAfter: number) {
    const page = document.createElement('div');
    const column = document.createElement('section');
    const row = document.createElement('div');
    page.appendChild(column);
    column.appendChild(row);
    document.body.appendChild(page);
    const styles = new Map<Element, Partial<CSSStyleDeclaration>>([
      [page, { overflowY: 'auto', scrollPaddingTop: '64px' }],
      [column, { overflowY: columnOverflow, scrollPaddingTop: 'auto' }],
    ]);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => (styles.get(el) ?? { overflowY: 'visible' }) as CSSStyleDeclaration);
    page.getBoundingClientRect = () => rect(0);
    page.scrollTop = 1000;
    column.getBoundingClientRect = () => rect(100);
    let scrolled = false;
    column.scrollTo = vi.fn(() => { scrolled = true; }) as unknown as typeof column.scrollTo;
    page.scrollTo = vi.fn() as unknown as typeof page.scrollTo;
    row.getBoundingClientRect = () => rect(scrolled ? rowTopAfter : 900);
    row.scrollIntoView = vi.fn();
    return { page, column, row };
  }

  it('from lg scrolls the column alone, the row to its top, when the row is then in sight', () => {
    const { page, column, row } = setup('auto', 108);
    bringRowIntoView(row, column);
    expect(column.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 792 });
    expect(page.scrollTo).not.toHaveBeenCalled();
  });

  it('moves the page too, alone, only when the row is still off the window', () => {
    const { page, column, row } = setup('auto', -200);
    bringRowIntoView(row, column);
    expect(page.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1000 - 200 - 64 });
  });

  it('stacked below lg, scrolls the page to the row, under its scroll padding, never through scrollIntoView', () => {
    const { page, column, row } = setup('visible', 0);
    bringRowIntoView(row, column);
    expect(column.scrollTo).not.toHaveBeenCalled();
    expect(page.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1000 + 900 - 64 });
    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('keepLinkAt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('puts the link back at its height by moving the scroller it reads in', () => {
    const column = document.createElement('div');
    const link = document.createElement('span');
    column.appendChild(link);
    document.body.appendChild(column);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({ overflowY: el === column ? 'auto' : 'visible' }) as CSSStyleDeclaration);
    column.scrollTop = 0;
    column.scrollTo = vi.fn() as unknown as typeof column.scrollTo;
    link.getBoundingClientRect = () => ({ top: 2400 } as DOMRect);
    keepLinkAt(link, 400);
    expect(column.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 2000 });
  });

  it('does nothing for a link gone from the page, or one still where it was', () => {
    const link = document.createElement('span');
    expect(() => keepLinkAt(link, 400)).not.toThrow();
    const column = document.createElement('div');
    column.appendChild(link);
    document.body.appendChild(column);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({ overflowY: el === column ? 'auto' : 'visible' }) as CSSStyleDeclaration);
    column.scrollTo = vi.fn() as unknown as typeof column.scrollTo;
    link.getBoundingClientRect = () => ({ top: 400 } as DOMRect);
    keepLinkAt(link, 400);
    expect(column.scrollTo).not.toHaveBeenCalled();
  });
});
