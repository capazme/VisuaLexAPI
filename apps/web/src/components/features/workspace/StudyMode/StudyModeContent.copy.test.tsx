import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudyModeContent } from './StudyModeContent';
import { fixtureText } from '../../../../utils/__fixtures__/articleTexts';
import type { ArticleData } from '../../../../types';

const ARTICLE: ArticleData = {
  article_text: fixtureText('nrm-cc-1284'),
  norma_data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', allegato: '2' },
};
const WORDS = 'Gli interessi superiori alla misura legale';
const RECT = { x: 40, y: 120, width: 90, height: 18 };

function select(container: HTMLElement, needle: string) {
  const root = container.querySelector('.vlx-art');
  if (!root) throw new Error('no text on screen');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const at = node.data.indexOf(needle);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + needle.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(root);
    return;
  }
  throw new Error(`"${needle}" is not in the text`);
}

describe('StudyModeContent — copying the words of the text in force', () => {
  const original = Range.prototype.getBoundingClientRect;
  let writeText: Mock<(text: string) => Promise<void>>;

  beforeEach(() => {
    Range.prototype.getBoundingClientRect = () =>
      ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
    writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    Range.prototype.getBoundingClientRect = original;
  });

  it('starts the copy with the citation of the text in force (D8)', async () => {
    const { container } = render(
      <StudyModeContent
        article={ARTICLE}
        fontSize={18}
        lineHeight={1.6}
        theme="light"
        highlights={[]}
        annotations={[]}
        normaKey="k"
        onAddHighlight={() => {}}
      />,
    );
    select(container, WORDS);
    fireEvent.click(await screen.findByTitle(/^Copia \(/));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(
      new RegExp(`^art\\. 1284 c\\.c\\. \\(Normattiva, testo vigente, consultato (?:il |l')[^)]+\\)\\n\\n${WORDS}$`),
    );
  });
});
