import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArticleNavigation } from './ArticleNavigation';

const ALL = ['2042', '2043', '2044'];

function nav(overrides: Partial<Parameters<typeof ArticleNavigation>[0]> = {}) {
  const onNavigate = vi.fn();
  const onLoadArticle = vi.fn();
  const utils = render(
    <ArticleNavigation
      allArticleIds={ALL}
      loadedArticleIds={['2042', '2043']}
      activeArticleId="2043"
      onNavigate={onNavigate}
      onLoadArticle={onLoadArticle}
      {...overrides}
    />,
  );
  return { ...utils, onNavigate, onLoadArticle };
}

describe('ArticleNavigation (LC68)', () => {
  it('says the article\'s own number, not its place in the index', () => {
    nav();
    expect(screen.getByRole('button', { name: /^Art\. 2043/ })).toHaveTextContent('Art. 2043');
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
  });

  it('the arrows name and lead to the article before and after; one to load says so, with no dot', () => {
    const { container, onNavigate, onLoadArticle } = nav();
    fireEvent.click(screen.getByRole('button', { name: 'Art. 2042' }));
    expect(onNavigate).toHaveBeenCalledWith('2042');
    fireEvent.click(screen.getByRole('button', { name: 'Carica Art. 2044' }));
    expect(onLoadArticle).toHaveBeenCalledWith('2044');
    expect(container.querySelector('.rounded-full')).toBeNull();
    expect(container.querySelector('.absolute')).toBeNull();
  });

  it('a tap on the number opens the field; Enter goes to the article written', () => {
    const { onNavigate } = nav();
    fireEvent.click(screen.getByRole('button', { name: /^Art\. 2043/ }));
    const field = screen.getByRole('textbox', { name: "Numero dell'articolo" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: '2042' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('2042');
  });

  it('44 px to tap on a phone, compact from md', () => {
    nav();
    for (const name of ['Art. 2042', /^Art\. 2043/, 'Carica Art. 2044']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]', 'md:min-h-0');
    }
  });
});

describe('ArticleNavigation: the tabs\' ground under the pointer (LC72)', () => {
  const ANSWERS = '.vlx-hover-tile:not(:disabled, [aria-pressed="true"], [aria-expanded="true"])';

  it('the arrows and the number carry it; a disabled arrow does not answer', () => {
    nav({ activeArticleId: '2042' });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).toHaveClass('vlx-hover-tile');
    const before = buttons[0];
    expect(before).toBeDisabled();
    expect(before.matches(ANSWERS)).toBe(false);
    expect(screen.getByRole('button', { name: /^Art\. 2042/ }).matches(ANSWERS)).toBe(true);
  });
});
