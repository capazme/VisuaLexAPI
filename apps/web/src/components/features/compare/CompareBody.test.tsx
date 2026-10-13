import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CompareView } from './CompareView';
import { closeCompare, setCompareState, type CompareArticle } from '../../../hooks/useCompare';
import { TOO_LONG_TEXT } from './compareLayout';
import { ARTICLE_FIXTURES, fixtureText } from '../../../utils/__fixtures__/articleTexts';
import type { ArticleData, NormaVisitata } from '../../../types';

const CC: NormaVisitata = { tipo_atto: 'codice civile', data: '', numero_articolo: '1284' };

function setViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const compareArticle = (text: string, norma: Partial<NormaVisitata> = {}, label = 'art. 1284 c.c.'): CompareArticle => {
  const article: ArticleData = { article_text: text, norma_data: { ...CC, ...norma } };
  return { article, sourceNorma: { tipo_atto: CC.tipo_atto }, label };
};
const past = (text: string, date = '2015-12-31') => compareArticle(text, { versione: 'vigente', data_versione: date }, `art. 1284 c.c. — testo al ${date}`);

function open(left: CompareArticle, right: CompareArticle) {
  setCompareState({ isOpen: true, leftArticle: left, rightArticle: right });
  return render(<CompareView />);
}

const side = (container: HTMLElement, s: 'left' | 'right') => [...container.querySelectorAll(`[data-side="${s}"] .vlx-art`)];
const spelled = (container: HTMLElement, s: 'left' | 'right') => side(container, s).map((el) => el.textContent).join('');
const showAll = () => {
  const toggle = screen.queryByRole('switch', { name: 'Solo le modifiche' });
  if (toggle?.getAttribute('aria-checked') === 'true') fireEvent.click(toggle);
};
const pills = () => screen.queryAllByTestId('compare-pill').map((p) => p.textContent);

const normattiva = (heading: string, rubric: string | null, commi: string[]) =>
  [heading, ...(rubric ? [`(${rubric}).`] : []), ...commi].join(' \n\n ');

const words = (n: number, tag = 'p') => Array.from({ length: n }, (_, i) => `${tag}${i}x`).join(' ');

beforeEach(() => {
  closeCompare();
  setViewport(true);
});

afterEach(() => {
  cleanup();
  closeCompare();
});

/** A copy with one word added in the middle of the body: every real text gets a comma that differs. */
function edited(raw: string): string {
  const tail = raw.indexOf('AGGIORNAMENTO');
  const body = tail === -1 ? raw.length : tail;
  const at = raw.indexOf(' ', Math.floor(body * 0.4));
  return at === -1 ? raw : `${raw.slice(0, at)} nuovo${raw.slice(at)}`;
}

describe('CompareView — each column spells its text (root rule 23)', () => {
  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))('%s against a lightly edited copy', (_id, raw) => {
    const copy = edited(raw);
    const { container } = open(past(raw), compareArticle(copy));
    showAll();
    expect(spelled(container, 'left')).toBe(raw.replace(/\n/g, ''));
    expect(spelled(container, 'right')).toBe(copy.replace(/\n/g, ''));
  });

  it('holds with the diff marks and the phone\'s Differenze view too', () => {
    const raw = fixtureText('nrm-cc-1284');
    const copy = edited(raw);
    const { container } = open(past(raw), compareArticle(copy));
    showAll();
    expect(container.querySelectorAll('.vlx-ins').length).toBeGreaterThan(0);
    expect(spelled(container, 'right')).toBe(copy.replace(/\n/g, ''));
    cleanup();
    setViewport(false);
    const phone = open(past(raw), compareArticle(copy));
    showAll();
    fireEvent.click(screen.getAllByRole('button', { name: 'Differenze' })[0]);
    expect(phone.container.querySelectorAll('.vlx-del, .vlx-ins').length).toBeGreaterThan(0);
  });
});

describe('CompareView — versions', () => {
  const older = normattiva('Art. 3000.', 'Rubrica', [
    '1. Il debitore risponde dell\'inadempimento con tutti i suoi beni presenti e futuri.',
    '2. Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.',
    `3. ${words(12, 'a')}`,
    '4. Il quarto comma che sarà tolto dal legislatore con una riforma successiva dell\'articolo.',
  ]);
  const newer = normattiva('Art. 3000.', 'Rubrica', [
    '1. Il debitore risponde dell\'inadempimento con tutti i suoi beni presenti e futuri.',
    '2. Il saggio degli interessi legali è determinato in misura pari al 10 per cento in ragione d\'anno.',
    `3. ${words(12, 'b')}`,
    '5. Un comma interamente nuovo, aggiunto da un intervento successivo del legislatore.',
  ]);

  it('says in words what changed, and folds the invariati', () => {
    open(past(older), compareArticle(newer));
    expect(screen.getByTestId('compare-summary')).toHaveTextContent(
      'Dal testo al 31 dicembre 2015 al testo in vigore: 1 comma modificato, 1 riscritto, 1 aggiunto, 1 abrogato · 1 invariato',
    );
    // the rubric first (unchanged), then the commi; the unchanged first comma is folded
    expect(pills()).toEqual(['invariato', 'modificato', 'riscritto', 'abrogato', 'aggiunto']);
    expect(screen.getByTestId('compare-fold')).toHaveTextContent('1 comma invariato · mostra');
  });

  it('shows the invariati on «mostra» and on switching «Solo le modifiche» off, and folds them again', () => {
    open(past(older), compareArticle(newer));
    fireEvent.click(screen.getByTestId('compare-fold'));
    expect(screen.queryByTestId('compare-fold')).toBeNull();
    expect(pills()).toEqual(['invariato', 'invariato', 'modificato', 'riscritto', 'abrogato', 'aggiunto']);
    const toggle = screen.getByRole('switch', { name: 'Solo le modifiche' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('compare-fold')).toBeInTheDocument();
  });

  it('marks the deleted words in the older column and the inserted ones in the newer, never in a riscritto comma', () => {
    const { container } = open(past(older), compareArticle(newer));
    expect([...container.querySelectorAll('[data-side="left"] .vlx-del')].map((e) => e.textContent)).toEqual(['5']);
    expect([...container.querySelectorAll('[data-side="right"] .vlx-ins')].map((e) => e.textContent)).toEqual(['10']);
    expect(container.querySelectorAll('[data-side="left"] .vlx-ins, [data-side="right"] .vlx-del')).toHaveLength(0);
    const riscritto = container.querySelector('[data-compare-row="comma"][data-label="riscritto"]')!;
    expect(riscritto.querySelectorAll('.vlx-del, .vlx-ins')).toHaveLength(0);
  });

  it('keeps the marks on the right sides when the older text stands on the right', () => {
    const { container } = open(compareArticle(newer), past(older));
    expect([...container.querySelectorAll('[data-side="right"] .vlx-del')].map((e) => e.textContent)).toEqual(['5']);
    expect([...container.querySelectorAll('[data-side="left"] .vlx-ins')].map((e) => e.textContent)).toEqual(['10']);
  });

  it('draws a hatched gap where a side has no comma', () => {
    const { container } = open(past(older), compareArticle(newer));
    const removed = container.querySelector('[data-compare-row="comma"][data-label="abrogato"]')!;
    expect(removed.querySelector('[data-gap-side="right"]')).not.toBeNull();
    expect(removed.querySelector('[data-side="left"]')).not.toBeNull();
    const added = container.querySelector('[data-compare-row="comma"][data-label="aggiunto"]')!;
    expect(added.querySelector('[data-gap-side="left"]')).not.toBeNull();
    expect(within(added as HTMLElement).getByRole('img', { name: /Nessun comma/ })).toBeInTheDocument();
  });

  it('labels the rubric above the commi', () => {
    const changed = normattiva('Art. 3000.', 'Rubrica del tutto diversa e nuova', ['1. Un comma.']);
    const same = normattiva('Art. 3000.', 'Rubrica', ['1. Un comma.']);
    const { container } = open(past(same), compareArticle(changed));
    const rubric = container.querySelector('[data-compare-row="rubric"]')!;
    expect(rubric).toHaveAttribute('data-label', 'riscritto');
    expect(screen.getByTestId('compare-summary')).toHaveTextContent('rubrica riscritta');
  });

  it('says why a long comma has no word marks', () => {
    const base = `1. ${words(601)}`;
    open(past(base), compareArticle(base.replace('p10x', 'changed')));
    expect(pills()).toEqual(['riscritto']);
    expect(screen.getByText(TOO_LONG_TEXT)).toBeInTheDocument();
    expect(document.querySelectorAll('.vlx-del, .vlx-ins')).toHaveLength(0);
  });

  it('folds the update notes under each column and opens a note from its reference', () => {
    const raw = fixtureText('nrm-cc-1284');
    const { container } = open(past(raw), compareArticle(edited(raw)));
    showAll();
    expect(container.querySelectorAll('[data-compare-row="tail"] .vlx-updates')).toHaveLength(2);
    const chip = container.querySelector<HTMLElement>('[data-side="left"] .vlx-ref')!;
    fireEvent.click(chip);
    expect(screen.getByRole('dialog')).toHaveTextContent(`Aggiornamento (${chip.dataset.note})`);
  });

  it('has no «Mostra Diff», no similarity and no ArticleDiff', () => {
    open(past(older), compareArticle(newer));
    expect(screen.queryByText(/Mostra Diff|Nascondi Diff|Similarit/)).toBeNull();
    expect(Object.keys(import.meta.glob('./*.tsx')).some((f) => f.includes('ArticleDiff'))).toBe(false);
  });
});

describe('CompareView — two articles', () => {
  it('sets the commi side by side with no pills, no switch and no marks', () => {
    const a = compareArticle(normattiva('Art. 2043.', 'Risarcimento', ['Qualunque fatto doloso o colposo cagiona un danno ingiusto.']), { numero_articolo: '2043' }, 'art. 2043 c.c.');
    const b = compareArticle(normattiva('Art. 2059.', 'Danni non patrimoniali', ['1. Primo comma.', '2. Secondo comma.']), { numero_articolo: '2059' }, 'art. 2059 c.c.');
    const { container } = open(a, b);
    expect(screen.getByTestId('compare-summary')).toHaveTextContent('Art. 2043 c.c. (1 comma) e art. 2059 c.c. (2 commi)');
    expect(screen.queryAllByTestId('compare-pill')).toHaveLength(0);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByTestId('compare-fold')).toBeNull();
    expect(container.querySelectorAll('.vlx-del, .vlx-ins')).toHaveLength(0);
    expect(container.querySelectorAll('[data-compare-row="comma"] [data-gap]')).toHaveLength(1);
    expect(spelled(container, 'left')).toBe(a.article.article_text!.replace(/\n/g, ''));
    expect(spelled(container, 'right')).toBe(b.article.article_text!.replace(/\n/g, ''));
  });
});

describe('CompareView — on a phone', () => {
  const older = normattiva('Art. 3000.', null, [
    '1. Il saggio degli interessi legali è determinato in misura pari al 5 per cento in ragione d\'anno.',
    '2. Il secondo comma resta lo stesso in entrambe le versioni del testo.',
  ]);
  const newer = normattiva('Art. 3000.', null, [
    '1. Il saggio degli interessi legali è determinato in misura pari al 10 per cento in ragione d\'anno.',
    '2. Il secondo comma resta lo stesso in entrambe le versioni del testo.',
    '3. Un comma interamente nuovo, aggiunto da un intervento successivo del legislatore.',
  ]);

  beforeEach(() => setViewport(false));

  it('offers the older version, the newer and «Differenze» for a modificato comma, at 44 px, newer first', () => {
    const { container } = open(past(older), compareArticle(newer));
    const row = container.querySelector<HTMLElement>('[data-compare-row="comma"][data-label="modificato"]')!;
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['31/12/2015', 'In vigore', 'Differenze']);
    expect(buttons.every((b) => b.className.includes('min-h-[44px]'))).toBe(true);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(row.querySelector('.vlx-art')!.textContent).toContain('10 per cento');
    expect(row.querySelectorAll('.vlx-del, .vlx-ins')).toHaveLength(0);

    fireEvent.click(buttons[0]);
    expect(row.querySelector('.vlx-art')!.textContent).toContain('5 per cento');
    fireEvent.click(within(row).getByRole('button', { name: 'Differenze' }));
    expect(row.querySelectorAll('.vlx-art')).toHaveLength(2);
    expect([...row.querySelectorAll('.vlx-del')].map((e) => e.textContent)).toEqual(['5']);
    expect([...row.querySelectorAll('.vlx-ins')].map((e) => e.textContent)).toEqual(['10']);
  });

  it('offers «Differenze» only for a modificato comma, and no switch for a comma on one side', () => {
    const { container } = open(past(older), compareArticle(newer));
    showAll();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-compare-row="comma"]')];
    expect(rows.map((r) => r.dataset.label)).toEqual(['modificato', 'invariato', 'aggiunto']);
    expect(within(rows[1]).queryByRole('button', { name: 'Differenze' })).toBeNull();
    expect(within(rows[1]).getAllByRole('button')).toHaveLength(2);
    expect(within(rows[2]).queryAllByRole('button')).toHaveLength(0);
  });

  it('is a full-screen reading with «‹ Pratica» to go back', () => {
    open(past(older), compareArticle(newer));
    const back = screen.getByRole('button', { name: /Pratica/ });
    expect(back.className).toContain('min-h-[44px]');
    fireEvent.click(back);
    expect(screen.queryByTestId('compare-body')).toBeNull();
  });

  it('names the sides of two articles on the switch', () => {
    const a = compareArticle('1. Primo.', { numero_articolo: '2043' }, 'art. 2043 c.c.');
    const b = compareArticle('1. Secondo.', { numero_articolo: '2059' }, 'art. 2059 c.c.');
    const { container } = open(a, b);
    const row = container.querySelector<HTMLElement>('[data-compare-row="comma"]')!;
    expect(within(row).getAllByRole('button').map((x) => x.textContent)).toEqual(['art. 2043 c.c.', 'art. 2059 c.c.']);
  });
});
