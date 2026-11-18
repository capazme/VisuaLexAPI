import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleDiscussionPassageSummary, ArticleDiscussionThread } from '../../../types';
import type { LocatedThread } from '../../../utils/articleAnnotations';
import { buildPassage } from '../../../utils/threadPassages';
import { AlignedGlosses } from './AlignedGlosses';

const PLAIN = 'Lo Stato ha legislazione esclusiva: tutela della concorrenza; referendum statali; elezione del Parlamento europeo.';
const at = (words: string) => PLAIN.indexOf(words);

function gloss(id: string, words: string): { thread: ArticleDiscussionThread; located: LocatedThread } {
  const passage = buildPassage(PLAIN, at(words), words)!;
  const thread = {
    id, title: words, passage, articleUrn: null, textHash: null, commentCount: 0, createdAt: '2026-11-18', updatedAt: '2026-11-18',
    user: { id: 'u', username: 'marta' }, normaKey: 'k', articleId: '117', version: 'vigente', target: { kind: 'article' },
    passageReleased: false, body: '', voteCount: 0, userVoted: false, isOwner: false, comments: [],
  } as ArticleDiscussionThread & ArticleDiscussionPassageSummary;
  return { thread, located: { thread, start: at(words), end: at(words) + words.length } };
}
const concorrenza = gloss('a', 'tutela della concorrenza');
const referendum = gloss('b', 'referendum statali');
const europeo = gloss('c', 'elezione del Parlamento europeo');

/** The top of each passage's first line, by where its words start in the text (jsdom lays nothing out). */
let lineTop: Record<number, number> = {};
const LIST_TOP = 100;
const CARD = 60;

/** jsdom has no ResizeObserver: one whose callbacks the test calls, as the text reflows. */
const resized: (() => void)[] = [];

let calls: { keyframes: Keyframe[] }[] = [];
function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  calls = [];
  lineTop = { [at('tutela della concorrenza')]: 300, [at('referendum statali')]: 500, [at('elezione del Parlamento europeo')]: 500 };
  // The frames run at once: the glosses are placed in the commit's frame.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: () => void;
    constructor(callback: () => void) { this.callback = callback; resized.push(callback); }
    observe() {}
    disconnect() { resized.splice(resized.indexOf(this.callback), 1); }
  });
  (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = function (this: Range) {
    const top = lineTop[this.startOffset];
    return top === undefined ? [] : [{ top, bottom: top + 24, height: 24, left: 0, right: 0, width: 0, x: 0, y: top } as DOMRect];
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const list = this.hasAttribute('data-gloss-aligned');
    const text = this.dataset.testid === 'text';
    return { top: list ? LIST_TOP : 0, left: list ? 400 : 0, right: text ? 380 : 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('vlx-gloss-card') ? CARD : 0;
  });
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[]) {
    calls.push({ keyframes });
    return { cancel: vi.fn(), finished: Promise.resolve() } as unknown as Animation;
  } as unknown as Element['animate'];
  reducedMotion(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Range.prototype as Partial<Range>).getClientRects;
  delete (Element.prototype as Partial<Element>).animate;
  resized.length = 0;
});

function Harness({ litId = null, contentKey = 'v1' }: { litId?: string | null; contentKey?: string }) {
  const textRef = useRef<HTMLDivElement>(null);
  const all = [europeo, concorrenza, referendum];
  return (
    <div>
      <div ref={textRef} data-testid="text">{PLAIN}</div>
      <section>
        <AlignedGlosses
          threads={all.map((g) => g.thread)}
          located={all.map((g) => g.located)}
          textRootRef={textRef}
          contentKey={contentKey}
          litId={litId}
          render={(t) => <article data-testid={`gloss-${t.id}`}>{t.title}</article>}
        />
      </section>
    </div>
  );
}

const topOf = (el: HTMLElement) => el.closest<HTMLElement>('.vlx-gloss-card')!.style.transform;

describe('AlignedGlosses — the glosses on a passage at the height of their words (LC90)', () => {
  it('places each at its passage\'s first line, in the order of the text; the second of two on one line goes under the first', () => {
    const { getByTestId, container } = render(<Harness />);
    // The list starts at 100: the first passage's line at 300 is 200 into it.
    expect(topOf(getByTestId('gloss-a'))).toBe('translateY(200px)');
    expect(topOf(getByTestId('gloss-b'))).toBe('translateY(400px)');
    // The same line as «referendum statali»: under it, its 60 px and the 8 px between them.
    expect(topOf(getByTestId('gloss-c'))).toBe('translateY(468px)');
    expect([...container.querySelectorAll('[data-gloss-row] article')].map((a) => a.textContent)).toEqual([
      'tutela della concorrenza', 'referendum statali', 'elezione del Parlamento europeo',
    ]);
    expect(container.querySelector<HTMLElement>('[data-gloss-aligned]')!.style.height).toBe(`${468 + CARD}px`);
  });

  it('places them again when the text reflows (a narrower window, a row opened above)', () => {
    const { getByTestId } = render(<Harness />);
    lineTop[at('tutela della concorrenza')] = 340;
    lineTop[at('referendum statali')] = 620;
    lineTop[at('elezione del Parlamento europeo')] = 700;
    act(() => { [...resized].forEach((run) => run()); });
    expect(topOf(getByTestId('gloss-a'))).toBe('translateY(240px)');
    expect(topOf(getByTestId('gloss-b'))).toBe('translateY(520px)');
    expect(topOf(getByTestId('gloss-c'))).toBe('translateY(600px)');
  });

  it('joins the chosen gloss to its words with a thread, drawn in', () => {
    const { container, rerender } = render(<Harness />);
    expect(container.querySelector('[data-gloss-wire]')).toBeNull();
    rerender(<Harness litId="c" />);
    // From the text's right edge (380, 20 px left of the list) at the middle of its line, down to the card pushed under.
    expect(container.querySelector('[data-gloss-wire="c"] path')).toHaveAttribute('d', 'M-20 412H-10V480H0');
    expect(calls.map((c) => c.keyframes)).toEqual([[{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }]]);
  });

  it('under reduced motion, the thread is simply there', () => {
    reducedMotion(true);
    const { container } = render(<Harness litId="a" />);
    expect(container.querySelector('[data-gloss-wire="a"] path')).toHaveAttribute('d', 'M-20 212H0');
    expect(calls).toHaveLength(0);
  });
});
