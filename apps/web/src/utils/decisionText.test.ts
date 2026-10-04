import { describe, expect, it } from 'vitest';
import { decisionClipboardText, decisionParagraphs, hasDecisionText } from './decisionText';

describe('decisionParagraphs', () => {
  it('groups lines at empty lines and drops only the newlines', () => {
    const text = 'LA CORTE\nSUPREMA DI CASSAZIONE\n\n  ha pronunciato\nla seguente\n\n\nORDINANZA';
    const paragraphs = decisionParagraphs(text);
    expect(paragraphs).toEqual([['LA CORTE', 'SUPREMA DI CASSAZIONE'], ['  ha pronunciato', 'la seguente'], ['ORDINANZA']]);
    expect(paragraphs.flat().join('')).toBe(text.replaceAll('\n', ''));
  });

  it('keeps the space that ends a paragraph the server restored with a blank line', () => {
    const text = 'Premessa. \n\nFATTI DI CAUSA Il fatto. \n\nP.Q.M. Rigetta.';
    const paragraphs = decisionParagraphs(text);
    expect(paragraphs).toEqual([['Premessa. '], ['FATTI DI CAUSA Il fatto. '], ['P.Q.M. Rigetta.']]);
    expect(paragraphs.flat().join('')).toBe(text.replaceAll('\n', ''));
  });
});

/** The markup DecisionTextView draws: blocks of paragraphs of one span per line. */
function drawn(blocks: string[][][]): HTMLElement {
  const root = document.createElement('div');
  for (const paragraphs of blocks) {
    const block = root.appendChild(document.createElement('section'));
    block.className = 'vlx-dec-block';
    for (const lines of paragraphs) {
      const paragraph = block.appendChild(document.createElement('p'));
      paragraph.className = 'vlx-dec-para';
      for (const line of lines) {
        const span = paragraph.appendChild(document.createElement('span'));
        span.className = 'vlx-dec-line';
        span.textContent = line;
      }
    }
  }
  return root;
}

/** The text node of the nth line, in document order. */
function lineText(root: HTMLElement, n: number): Text {
  return root.querySelectorAll('.vlx-dec-line')[n].firstChild as Text;
}

function clipboardOf(range: Range): string {
  return decisionClipboardText(range.cloneContents());
}

describe('decisionClipboardText', () => {
  it('puts one space between the lines of a paragraph and a blank line between paragraphs and blocks', () => {
    const root = drawn([
      [['LA CORTE COSTITUZIONALE', 'composta dai signori:  Presidente']],
      [['1.- Con ordinanza', 'del 17 maggio 2013,'], ['la Corte di cassazione']],
    ]);
    const range = document.createRange();
    range.selectNodeContents(root);
    // the two spaces inside a line are the received text's: only the separators are added
    expect(clipboardOf(range)).toBe(
      'LA CORTE COSTITUZIONALE composta dai signori:  Presidente\n\n1.- Con ordinanza del 17 maggio 2013,\n\nla Corte di cassazione',
    );
  });

  it('reads a selection that starts and ends inside lines', () => {
    const root = drawn([[['Con ordinanza', 'del 17 maggio 2013,'], ['la Corte di cassazione']]]);
    const range = document.createRange();
    range.setStart(lineText(root, 0), 4);
    range.setEnd(lineText(root, 2), 6);
    expect(clipboardOf(range)).toBe('ordinanza del 17 maggio 2013,\n\nla Cor');
  });

  it('gives a selection inside one line as it is', () => {
    const root = drawn([[['Con ordinanza', 'del 17 maggio 2013,']]]);
    const range = document.createRange();
    range.setStart(lineText(root, 0), 4);
    range.setEnd(lineText(root, 0), 13);
    expect(clipboardOf(range)).toBe('ordinanza');
  });

  it('adds a space only where the lines do not already have one', () => {
    const root = drawn([[['A', 'B'], ['Premessa. ', 'FATTI DI CAUSA'], ['C', ' D']]]);
    const range = document.createRange();
    range.selectNodeContents(root);
    expect(clipboardOf(range)).toBe('A B\n\nPremessa. FATTI DI CAUSA\n\nC D');
  });

  it('keeps the space that ends a paragraph', () => {
    const root = drawn([[['Premessa. '], ['FATTI DI CAUSA Il fatto. ']]]);
    const range = document.createRange();
    range.selectNodeContents(root);
    expect(clipboardOf(range)).toBe('Premessa. \n\nFATTI DI CAUSA Il fatto. ');
  });

  it('adds nothing for a paragraph a selection only reaches the start of', () => {
    // a triple click ends at offset 0 of the next paragraph: its clone holds an empty line
    const root = drawn([[['prima riga', 'seconda riga'], ['altro paragrafo']]]);
    const range = document.createRange();
    range.setStart(lineText(root, 0), 0);
    range.setEnd(lineText(root, 2), 0);
    expect(clipboardOf(range)).toBe('prima riga seconda riga');
  });

  it('is empty for an empty selection', () => {
    const root = drawn([[['prima riga']]]);
    const range = document.createRange();
    range.setStart(lineText(root, 0), 3);
    range.setEnd(lineText(root, 0), 3);
    expect(clipboardOf(range)).toBe('');
  });
});

describe('hasDecisionText', () => {
  it('is false only for the empty text of a decision found without it', () => {
    expect(hasDecisionText({})).toBe(false);
    expect(hasDecisionText({ dispositivo: 'dichiara' })).toBe(true);
    // an ordinanza whose epigrafe has no «Ritenuto» line comes without a motivazione
    expect(hasDecisionText({ epigrafe: 'ha pronunciato la seguente' })).toBe(true);
  });
});
