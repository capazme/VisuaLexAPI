import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { appStore } from '../../../store/useAppStore';
import type { DecisionIdentity, DecisionText } from '../../../types/decisions';
import { decisionProjection } from '../../../utils/decisionRender';
import { DECISION_TEXTS } from '../../../utils/__fixtures__/decisionTexts';
import { DecisionReadingSurface } from './DecisionReadingSurface';

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 };
const TESTO: DecisionText = {
  epigrafe: 'LA CORTE DI CASSAZIONE\nsezione terza civile',
  motivazione: 'Il ricorrente invoca l\'art. 2043 c.c. e,\n\nquanto al termine, l\'art. 5 della stessa disciplina.',
  dispositivo: 'P.Q.M. rigetta il ricorso.',
};

const textOf = (root: Element) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out += n.nodeValue;
  return out;
};

beforeEach(() => appStore.setState({ searchTrigger: null, readingBackStack: [], workspaceTabs: [] }));

describe('DecisionReadingSurface', () => {
  it('links «art. 2043 c.c.» and leaves a bare «art. 5» as text', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} />);
    const links = [...container.querySelectorAll('.citation-hover')];
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => /2043|c\.c\./.test(l.textContent ?? ''))).toBe(true);
    expect(links.some((l) => /art\. 5\b/.test(l.textContent ?? ''))).toBe(false);
    expect(container.textContent).toContain('l\'art. 5 della stessa');
    expect(container.querySelector('.vlx-art.vlx-decision')).not.toBeNull();
  });

  it('keeps the contract: the rendered text nodes spell the projection, the citation spans only wrap', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    expect(textOf(container.querySelector('.vlx-decision')!)).toBe(decisionProjection(TESTO));
  });

  it('a click searches the norm beside the host tab and records the way back to the decision', () => {
    const { container } = render(
      <DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{ sezione: '3' }} hostTabId="dec-tab" />,
    );
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(appStore.getState().searchTrigger).toEqual({
      act_type: 'codice civile', act_number: '', date: '', article: '2043',
      version: 'vigente', show_brocardi_info: true, besideTabId: 'dec-tab',
    });
    expect(appStore.getState().readingBackStack).toEqual([
      { tabId: 'dec-tab', blockId: 'dec-tab', articleId: '', label: 'Cass. civ., sez. III, n. 10787/2024' },
    ]);
  });

  it('without a host tab the norm opens by the ordinary search and no way back is recorded', () => {
    const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={TESTO} attributi={{}} />);
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '2043' });
    expect(appStore.getState().searchTrigger).not.toHaveProperty('besideTabId');
    expect(appStore.getState().readingBackStack).toEqual([]);
  });

  // The real mount (ArticleBody -> SafeHTML -> DOMPurify), over every fixture. The carriage-return
  // fixture is a renderer-level case: the readers normalise CR to LF (italgiure:v4), so none
  // reaches a page, and the sanitiser's re-serialisation would read one as a line feed. A decision
  // without text never mounts the surface (DecisionView draws a notice instead).
  for (const [name, testo] of Object.entries(DECISION_TEXTS).filter(([n, t]) => n !== 'carriage_return' && decisionProjection(t) !== '')) {
    it(`${name}: the rendered text nodes spell the projection`, () => {
      const { container } = render(<DecisionReadingSurface identity={IDENTITY} testo={testo} attributi={{}} />);
      expect(textOf(container.querySelector('.vlx-decision')!)).toBe(decisionProjection(testo));
    });
  }

  it('copies a selection across two lines with the space between them, as the plain view did', () => {
    const { container } = render(
      <DecisionReadingSurface identity={IDENTITY} testo={{ motivazione: 'prima riga\nseconda riga' }} attributi={{}} />,
    );
    const lines = container.querySelectorAll('.vlx-dec-line');
    expect(lines).toHaveLength(2);
    const range = document.createRange();
    range.setStart(lines[0].firstChild!, 6);
    range.setEnd(lines[1].firstChild!, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const setData = vi.fn();
    const notPrevented = fireEvent.copy(container.querySelector('.vlx-decision')!, { clipboardData: { setData } });
    expect(notPrevented).toBe(false);
    expect(setData).toHaveBeenCalledWith('text/plain', 'riga seconda');
  });
});
