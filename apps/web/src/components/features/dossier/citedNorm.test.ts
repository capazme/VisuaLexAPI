import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DossierItem } from '../../../types';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import { bringRowIntoView, citedArticleOf } from './citedNorm';

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
  afterEach(() => vi.restoreAllMocks());

  const rect = (top: number) => ({ top, bottom: top + 44, left: 0, right: 0, width: 0, height: 44, x: 0, y: top, toJSON: () => ({}) });

  function setup(overflowY: string, rowTopAfter: number) {
    const column = document.createElement('section');
    const row = document.createElement('div');
    column.appendChild(row);
    document.body.appendChild(column);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowY } as CSSStyleDeclaration);
    column.getBoundingClientRect = () => rect(100);
    column.scrollTop = 0;
    let scrolled = false;
    column.scrollTo = vi.fn(() => { scrolled = true; }) as unknown as typeof column.scrollTo;
    row.getBoundingClientRect = () => rect(scrolled ? rowTopAfter : 900);
    row.scrollIntoView = vi.fn();
    return { column, row };
  }

  it('from lg scrolls the column alone, the row to its top, when the row is then in sight', () => {
    const { column, row } = setup('auto', 108);
    bringRowIntoView(row, column);
    expect(column.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 792 });
    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });

  it('moves the page too only when the row is still off the window', () => {
    const { column, row } = setup('auto', -200);
    bringRowIntoView(row, column);
    expect(row.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
  });

  it('stacked below lg, scrolls the page to the row', () => {
    const { column, row } = setup('visible', 0);
    bringRowIntoView(row, column);
    expect(column.scrollTo).not.toHaveBeenCalled();
    expect(row.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
  });
});
