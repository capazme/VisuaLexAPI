import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DecisionTextView } from './DecisionTextView';

const labels = (container: HTMLElement) =>
  [...container.querySelectorAll('section[data-label]')].map((s) => s.getAttribute('data-label'));

function textNodeOf(root: HTMLElement, text: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent === text) return node as Text;
  }
  throw new Error(`no text node «${text}»`);
}

function select(start: [Text, number], end: [Text, number]) {
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** A copy fired on `target`: what the page wrote to the clipboard, and whether it took the copy over. */
function copyFrom(target: Element) {
  const setData = vi.fn();
  const notPrevented = fireEvent.copy(target, { clipboardData: { setData } });
  return { setData, prevented: !notPrevented };
}

describe('DecisionTextView', () => {
  it('never adds, drops or changes a character of the received text but its newlines', () => {
    const testo = {
      epigrafe: 'LA CORTE COSTITUZIONALE\ncomposta dai signori:  Presidente',
      motivazione: '1.- Con ordinanza\ndel 17 maggio 2013,\n\nla Corte di cassazione',
      dispositivo: 'per questi motivi\n\n1) dichiara',
    };
    const { container } = render(<DecisionTextView testo={testo} />);
    const expected = [testo.epigrafe, testo.motivazione, testo.dispositivo].join('').replaceAll('\n', '');
    expect(container.textContent).toBe(expected);
    expect(labels(container)).toEqual(['Epigrafe', 'Motivazione', 'Dispositivo']);
  });

  it('labels an epigrafe without a motivazione «Testo»: the reasoning is in it, its start unmarked', () => {
    const { container } = render(
      <DecisionTextView testo={{ epigrafe: 'ha pronunciato la seguente\nRilevato che', dispositivo: 'per questi motivi' }} />,
    );
    expect(labels(container)).toEqual(['Testo', 'Dispositivo']);
    const reasoningOnly = render(<DecisionTextView testo={{ motivazione: 'Ritenuto che' }} />);
    expect(labels(reasoningOnly.container)).toEqual(['Motivazione']);
  });

  it('renders markup in the text as text', () => {
    const { container } = render(<DecisionTextView testo={{ motivazione: '<img src=x onerror=alert(1)>' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

// The space between two lines is CSS generated content, so the browser's own copy glues the words
// («ordinanzadel»): a copy inside the text composes the clipboard text itself, from the same range.
describe('DecisionTextView copying', () => {
  const testo = {
    epigrafe: 'LA CORTE COSTITUZIONALE\ncomposta dai signori:  Presidente',
    motivazione: '1.- Con ordinanza\ndel 17 maggio 2013,\n\nla Corte di cassazione',
    dispositivo: 'per questi motivi\n\n1) dichiara',
  };
  const received = [testo.epigrafe, testo.motivazione, testo.dispositivo].join('').replaceAll('\n', '');

  it('copies a passage over two lines and two paragraphs with its words apart', () => {
    const { container } = render(<DecisionTextView testo={testo} />);
    select([textNodeOf(container, '1.- Con ordinanza'), 4], [textNodeOf(container, 'la Corte di cassazione'), 11]);
    const { setData, prevented } = copyFrom(container.querySelector('.vlx-decision')!);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith('text/plain', 'Con ordinanza del 17 maggio 2013,\n\nla Corte di');
    expect(prevented).toBe(true);
    // the text nodes are the received text's, as before: the space is never in the DOM (S6)
    expect(container.textContent).toBe(received);
  });

  it('copies across two blocks with a blank line between them', () => {
    const { container } = render(<DecisionTextView testo={testo} />);
    select([textNodeOf(container, 'composta dai signori:  Presidente'), 23], [textNodeOf(container, '1.- Con ordinanza'), 3]);
    const { setData } = copyFrom(container.querySelector('.vlx-decision')!);
    expect(setData).toHaveBeenCalledWith('text/plain', 'Presidente\n\n1.-');
  });

  it('copies a selection inside one line as it is', () => {
    const { container } = render(<DecisionTextView testo={testo} />);
    select([textNodeOf(container, 'per questi motivi'), 4], [textNodeOf(container, 'per questi motivi'), 10]);
    const { setData } = copyFrom(container.querySelector('.vlx-decision')!);
    expect(setData).toHaveBeenCalledWith('text/plain', 'questi');
  });

  it('leaves to the browser a selection that is not all inside the text', () => {
    const { container } = render(
      <>
        <p>titolo della pagina</p>
        <DecisionTextView testo={testo} />
      </>,
    );
    const target = container.querySelector('.vlx-decision')!;
    // wholly outside
    select([textNodeOf(container, 'titolo della pagina'), 0], [textNodeOf(container, 'titolo della pagina'), 6]);
    const outside = copyFrom(target);
    expect(outside.setData).not.toHaveBeenCalled();
    expect(outside.prevented).toBe(false);
    // from the page's own text into the decision's
    select([textNodeOf(container, 'titolo della pagina'), 0], [textNodeOf(container, '1.- Con ordinanza'), 3]);
    const across = copyFrom(target);
    expect(across.setData).not.toHaveBeenCalled();
    expect(across.prevented).toBe(false);
  });

  it('leaves an empty selection to the browser', () => {
    const { container } = render(<DecisionTextView testo={testo} />);
    window.getSelection()!.removeAllRanges();
    const { setData, prevented } = copyFrom(container.querySelector('.vlx-decision')!);
    expect(setData).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });
});
