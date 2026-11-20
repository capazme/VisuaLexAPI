import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitsInView, opensUnder, revealBy, viewOf } from './selectionSpace';

// A phone's view at 390: 812 px tall, its top bar 64 px.
const view = { top: 64, bottom: 812 };

describe('where a selection\'s actions open (LC142, option A)', () => {
  it('under the paragraph when the words and the space fit in the view together', () => {
    expect(opensUnder(500, 400, view, 180)).toBe(true);
    expect(opensUnder(400 + 748 - 180, 400, view, 180)).toBe(true);
  });

  it('as an island from the words when the paragraph goes on further (a 55,572 px paragraph)', () => {
    expect(opensUnder(400 + 749 - 180, 400, view, 180)).toBe(false);
    expect(opensUnder(30_000, 400, view, 180)).toBe(false);
  });

  it('as an island in a low window, where the words and the space cannot both be seen (390×300)', () => {
    // 300 px, less the app's bar and the reader's toolbar down to 109: 191 px for a short comma and its space.
    expect(opensUnder(240, 200, { top: 109, bottom: 300 }, 180)).toBe(false);
  });
});

describe('bringing the space into view, the words kept in it', () => {
  it('does not move when the space is in view', () => {
    expect(revealBy(800, 300, view)).toBe(0);
  });

  it('moves by what the space lacks when the words keep room above', () => {
    expect(revealBy(900, 400, view)).toBe(88);
  });

  it('moves at most until the words reach the top bar, never past it', () => {
    expect(revealBy(1500, 300, view)).toBe(236);
    expect(revealBy(1500, 50, view)).toBe(0);
  });
});

describe('the space measured once drawn (LC145)', () => {
  it('fits when it is in view, or a scroll that keeps the words brings it in', () => {
    expect(fitsInView(800, 300, view)).toBe(true);
    expect(fitsInView(900, 400, view)).toBe(true);
  });

  it('does not fit when even the words at the top bar leave it past the foot (390×450, commands on several rows)', () => {
    // Bars down to 109 and from 400; words at 120; the drawn space, 308 px from 148, ends at 456.
    expect(fitsInView(456, 120, { top: 109, bottom: 400 })).toBe(false);
  });
});

describe('the view, measured with the bars over the text', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('leaves out the reader\'s sticky toolbar under the app\'s bar, and a fixed bar at the foot', () => {
    document.body.innerHTML = `
      <header id="app" style="position: fixed"></header>
      <div id="toolbar" style="position: sticky"><span id="tool">In vigore dal</span></div>
      <div id="text"><p id="para">Il testo</p></div>
      <nav id="foot" style="position: fixed"></nav>`;
    const at = (id: string) => document.getElementById(id)!;
    const boxes: Record<string, DOMRect> = {
      app: new DOMRect(0, 0, 390, 56),
      toolbar: new DOMRect(0, 56, 390, 53),
      tool: new DOMRect(10, 60, 80, 20),
      para: new DOMRect(0, 120, 390, 40),
      text: new DOMRect(0, 0, 390, 2000),
      foot: new DOMRect(0, 400, 390, 50),
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return boxes[this.id] ?? new DOMRect();
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 450 });
    // What is drawn at a point of the column: the app's bar, then the toolbar under it, the foot bar, else the text.
    document.elementFromPoint = (_x: number, y: number) => (y < 56 ? at('app') : y < 109 ? at('tool') : y >= 400 ? at('foot') : at('para'));
    expect(viewOf(at('para'))).toEqual({ top: 109, bottom: 400 });
  });

  it('takes a column that sticks as a whole for the text\'s own, not a bar', () => {
    document.body.innerHTML = '<div id="col" style="position: sticky"><h3 id="head">Art. 1</h3><p id="para">Il testo</p></div>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.id === 'para' ? new DOMRect(0, 100, 390, 40) : new DOMRect(0, 0, 390, 900);
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 });
    document.elementFromPoint = () => document.getElementById('head');
    expect(viewOf(document.getElementById('para')!)).toEqual({ top: 0, bottom: 812 });
  });
});
