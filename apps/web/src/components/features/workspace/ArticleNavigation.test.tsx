import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('after Enter or Esc the focus is back on «Art. …»; Esc loads nothing (LC70)', () => {
    const { onNavigate, onLoadArticle } = nav();
    const selector = () => screen.getByRole('button', { name: /^Art\. 2043/ });
    fireEvent.click(selector());
    fireEvent.keyDown(screen.getByRole('textbox', { name: "Numero dell'articolo" }), { key: 'Escape' });
    expect(selector()).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onLoadArticle).not.toHaveBeenCalled();
    fireEvent.click(selector());
    const field = screen.getByRole('textbox', { name: "Numero dell'articolo" });
    fireEvent.change(field, { target: { value: '9999' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onLoadArticle).toHaveBeenCalledWith('9999');
    expect(selector()).toHaveFocus();
  });

  it('the field\'s text is 16 px on a phone, so Safari does not zoom (LC70)', () => {
    nav();
    fireEvent.click(screen.getByRole('button', { name: /^Art\. 2043/ }));
    expect(screen.getByRole('textbox', { name: "Numero dell'articolo" })).toHaveClass('text-base', 'md:text-sm');
  });

  it('a real Enter (keydown, keypress, keyup) closes the field for good and stays on the number written (#556)', async () => {
    const user = userEvent.setup();
    const loads: string[] = [];
    function Live() {
      const [active, setActive] = useState('2045');
      const [loaded, setLoaded] = useState(['2044', '2045']);
      const go = (id: string) => { loads.push(id); setActive(id); setLoaded((l) => [...l, id]); };
      return (
        <ArticleNavigation
          allArticleIds={['2043', '2044', '2045', '2046', '2047']}
          loadedArticleIds={loaded}
          activeArticleId={active}
          onNavigate={setActive}
          onLoadArticle={go}
        />
      );
    }
    render(<><Live /><p>fuori</p></>);
    await user.click(screen.getByRole('button', { name: /^Art\. 2045/ }));
    const field = screen.getByRole('textbox', { name: "Numero dell'articolo" });
    await user.clear(field);
    await user.type(field, '2046{Enter}');
    expect(screen.queryByRole('textbox', { name: "Numero dell'articolo" })).toBeNull();
    expect(screen.getByRole('button', { name: /^Art\. 2046/ })).toHaveFocus();
    // A click elsewhere sends nothing back.
    await user.click(screen.getByText('fuori'));
    await act(async () => {});
    expect(loads).toEqual(['2046']);
    expect(screen.getByRole('button', { name: /^Art\. 2046/ })).toBeInTheDocument();
  });

  it('a real Esc closes the field and loads nothing (#556)', async () => {
    const user = userEvent.setup();
    const { onNavigate, onLoadArticle } = nav();
    await user.click(screen.getByRole('button', { name: /^Art\. 2043/ }));
    await user.type(screen.getByRole('textbox', { name: "Numero dell'articolo" }), '{Escape}');
    expect(screen.queryByRole('textbox', { name: "Numero dell'articolo" })).toBeNull();
    expect(screen.getByRole('button', { name: /^Art\. 2043/ })).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onLoadArticle).not.toHaveBeenCalled();
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
