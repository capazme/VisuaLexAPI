import { describe, expect, it } from 'vitest';
import { dragAnnouncements } from './dragAnnouncements';

const names: Record<string, string> = { a: 'Codice civile', b: 'l. 24/2017' };
const say = () => dragAnnouncements((id) => names[String(id)]);
const A = { id: 'a' };
const B = { id: 'b' };

describe('dragAnnouncements (LC61)', () => {
  it('on pick-up says «Hai preso X», and nothing reads «X sopra X»', () => {
    const s = say();
    expect(s.onDragStart({ active: A })).toBe('Hai preso Codice civile.');
    expect(s.onDragOver({ active: A, over: A })).toBeUndefined();
  });

  it('over another act, then back to its place, then dropped there', () => {
    const s = say();
    s.onDragStart({ active: A });
    expect(s.onDragOver({ active: A, over: B })).toBe('Codice civile sopra l. 24/2017.');
    expect(s.onDragOver({ active: A, over: A })).toBe('Codice civile di nuovo al suo posto.');
    expect(s.onDragEnd({ active: A, over: A })).toBe("Codice civile lasciato dov'era.");
  });

  it('dropped on another act, or outside the list', () => {
    const s = say();
    expect(s.onDragEnd({ active: A, over: B })).toBe('Codice civile spostato al posto di l. 24/2017.');
    expect(s.onDragEnd({ active: A, over: null })).toBe("Codice civile lasciato dov'era.");
  });
});
