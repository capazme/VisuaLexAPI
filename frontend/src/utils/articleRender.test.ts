import { describe, it, expect } from 'vitest';
import { renderArticleHtml, type RenderArticleInput } from './articleRender';
import { parseArticleStructure } from './articleStructure';
import { sanitizeHTML } from './sanitize';
import { plainOffsetAt } from './selectionOffset';
import { ARTICLE_FIXTURES, fixtureText } from './__fixtures__/articleTexts';
import type { Annotation, Highlight } from '../types';

const hl = (id: string, text: string, startOffset: number, color: Highlight['color'] = 'yellow'): Highlight => ({
  id, normaKey: 'k', articleId: '1', rangeSerialized: '', text, color, startOffset,
});
const note = (id: string, anchorText: string, startOffset: number): Annotation => ({
  id, normaKey: 'k', articleId: '1', text: `nota ${id}`, createdAt: '2026-09-25', anchorText, startOffset,
});
const render = (raw: string, extra: Partial<RenderArticleInput> = {}) =>
  renderArticleHtml({ raw, structure: parseArticleStructure(raw), highlights: [], annotations: [], ...extra });
const mount = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = sanitizeHTML(html);
  return div;
};
const pieces = (div: HTMLElement, selector: string) => [...div.querySelectorAll(selector)];
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

describe('the projection invariant — every real text', () => {
  it.each(ARTICLE_FIXTURES.map((f) => [f.id, f.text] as const))(
    '%s: text nodes spell article_text minus \\n; every mark sits at its offset',
    (_id, raw) => {
      const plain = raw.replace(/\n/g, '');
      const next = rng(raw.length);
      const highlights: Highlight[] = [];
      for (let i = 0; i < 12; i++) {
        const a = Math.floor(next() * (plain.length - 1));
        const len = 1 + Math.floor(next() * Math.min(80, plain.length - a - 1));
        highlights.push(hl(`h${i}`, plain.slice(a, a + len), a));
      }
      for (const updatesOpen of [false, true]) {
        const div = mount(render(raw, { highlights, updatesOpen }));
        expect(div.textContent).toBe(plain);
        for (const h of highlights) {
          const found = pieces(div, `[data-highlight="${h.id}"]`);
          expect(found.length, h.id).toBeGreaterThan(0);
          expect(found.map((e) => e.textContent).join('')).toBe(h.text);
          const walker = document.createTreeWalker(found[0], NodeFilter.SHOW_TEXT);
          expect(plainOffsetAt(div, walker.nextNode()!, 0)).toBe(h.startOffset);
        }
      }
    },
  );

  it('flat mode keeps the projection too', () => {
    for (const f of ARTICLE_FIXTURES) {
      const div = mount(renderArticleHtml({ raw: f.text, structure: null, highlights: [], annotations: [] }));
      expect(div.textContent, f.id).toBe(f.text.replace(/\n/g, ''));
    }
  });

  it('renders the whole fixture set with highlights in reasonable time', () => {
    const t0 = performance.now();
    for (const f of ARTICLE_FIXTURES) {
      const plain = f.text.replace(/\n/g, '');
      const hs = [0, 1, 2, 3].map((i) => hl(`p${i}`, plain.slice(i * 40, i * 40 + 30), i * 40));
      render(f.text, { highlights: hs, searchQuery: 'di' });
    }
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('escaping', () => {
  it('shows a "<" and an "&" in the source as themselves', () => {
    const raw = 'se a<b allora x &amp; y';
    const html = renderArticleHtml({ raw, structure: null, highlights: [], annotations: [] });
    expect(html).toBe('se a&lt;b allora x &amp;amp; y');
    expect(mount(html).textContent).toBe(raw);
  });

  it('escapes attribute values it writes', () => {
    const raw = 'Art. 1\n\nTesto con una nota.';
    const plain = raw.replace(/\n/g, '');
    const a: Annotation = { ...note('n"1', 'nota', plain.indexOf('nota')), text: 'dice "ciao" <b>' };
    const div = mount(render(raw, { annotations: [a] }));
    const anchor = div.querySelector('.note-anchor');
    expect(anchor?.getAttribute('title')).toBe('dice "ciao" <b>');
    expect(anchor?.getAttribute('data-note-id')).toBe('n"1');
  });
});

describe('blocks', () => {
  it('c.c. 1453: heading, rubric and commi become their own elements', () => {
    const div = mount(render(fixtureText('nrm-cc-1453')));
    expect(pieces(div, '.vlx-b').map((e) => e.className)).toEqual([
      'vlx-b vlx-heading', 'vlx-b vlx-rubrica', 'vlx-b vlx-comma', 'vlx-b vlx-comma', 'vlx-b vlx-comma',
    ]);
    expect(div.querySelectorAll('br')).toHaveLength(0);
    expect(pieces(div, '.vlx-rubrica .vlx-paren').map((e) => e.textContent)).toEqual(['(', ')']);
  });

  it('GDPR art. 6: a glued point gets its enumerator in a marker', () => {
    const div = mount(render(fixtureText('eu-gdpr-6')));
    const firstItem = div.querySelector('.vlx-item');
    expect(firstItem?.firstElementChild?.className).toBe('vlx-marker');
    expect(firstItem?.firstElementChild?.textContent).toBe('a)');
  });

  it('AI Act art. 5: sub-points carry their level', () => {
    const div = mount(render(fixtureText('eu-aiact-5')));
    expect(div.querySelectorAll('.vlx-item[data-level="2"]').length).toBeGreaterThanOrEqual(5);
  });

  it('keeps a line break inside a block and drops the ones on its edges', () => {
    const raw = fixtureText('akn-cost-3');
    const div = mount(render(raw));
    const commi = pieces(div, '.vlx-comma');
    expect(commi).toHaveLength(1);
    expect(commi[0].querySelectorAll('br')).toHaveLength(1);
  });
});

describe('marks', () => {
  it('splits a highlight dragged across two commi into one piece per comma', () => {
    const raw = fixtureText('nrm-cc-1453');
    const plain = raw.replace(/\n/g, '');
    const start = plain.indexOf('danno.');
    const end = plain.indexOf('La risoluzione') + 'La risoluzione'.length;
    expect(end).toBeGreaterThan(start);
    const div = mount(render(raw, { highlights: [hl('x', plain.slice(start, end), start)] }));
    const found = pieces(div, '[data-highlight="x"]');
    expect(found).toHaveLength(2);
    expect(found[0].closest('.vlx-comma')).not.toBe(found[1].closest('.vlx-comma'));
  });

  it('draws both of two overlapping highlights', () => {
    const raw = 'Art. 1\n\nABCDEFGHIJKLMNO';
    const plain = raw.replace(/\n/g, '');
    const at = plain.indexOf('ABCDE');
    const div = mount(render(raw, { highlights: [hl('a', 'ABCDEFGHIJ', at), hl('b', 'FGHIJKLMNO', at + 5, 'green')] }));
    expect(pieces(div, '[data-highlight="a"]').map((e) => e.textContent).join('')).toBe('ABCDEFGHIJ');
    expect(pieces(div, '[data-highlight="b"]').map((e) => e.textContent).join('')).toBe('FGHIJKLMNO');
  });

  it('rescues a highlight stored with the newlines of a rendered selection', () => {
    const raw = fixtureText('nrm-cc-1453');
    const plain = raw.replace(/\n/g, '');
    const start = plain.indexOf('danno.');
    const div = mount(render(raw, { highlights: [hl('old', 'danno.\n\nLa risoluzione', start)] }));
    expect(pieces(div, '[data-highlight="old"]').map((e) => e.textContent).join('')).toBe('danno.  La risoluzione');
  });

  it('still drops a highlight whose text is not there', () => {
    const raw = fixtureText('nrm-cc-1453');
    const plain = raw.replace(/\n/g, '');
    const div = mount(render(raw, { highlights: [hl('gone', 'danno. Xa', plain.indexOf('danno.'))] }));
    expect(div.querySelector('[data-highlight="gone"]')).toBeNull();
  });

  it('keeps a legacy highlight without offset on every occurrence', () => {
    const raw = 'Art. 1\n\nlegge della legge';
    const legacy: Highlight = { ...hl('l', 'legge', 0), startOffset: undefined };
    const div = mount(render(raw, { highlights: [legacy] }));
    expect(pieces(div, '[data-highlight="l"]')).toHaveLength(2);
  });

  it('numbers search hits in text order, for the Cmd+F navigation', () => {
    const div = mount(render(fixtureText('nrm-cc-1453'), { searchQuery: 'adempi' }));
    const idx = pieces(div, '.search-match').map((e) => Number(e.getAttribute('data-search-idx')));
    expect(idx.length).toBeGreaterThan(1);
    expect(idx).toEqual([...new Set(idx)].sort((x, y) => x - y));
  });

  it('draws a note anchor with the attributes the reader listens for', () => {
    const raw = fixtureText('nrm-cc-1453');
    const plain = raw.replace(/\n/g, '');
    const div = mount(render(raw, { annotations: [note('n1', 'Risolubilità', plain.indexOf('Risolubilità'))] }));
    const anchor = div.querySelector('.note-anchor[data-note-id="n1"]');
    expect(anchor?.textContent).toBe('Risolubilità');
  });
});

describe('Normattiva markers', () => {
  it('c.p. 640: references are buttons, modifications dashed, the tail collapsed with a CSS label', () => {
    const raw = fixtureText('nrm-cp-640');
    const html = render(raw);
    expect(html).toContain('<span class="vlx-ref" role="button" tabindex="0"');
    expect(html).toContain('data-note="119"');
    expect(html).toContain('data-open="false"');
    expect(html).toContain('data-label="Note di aggiornamento (2)"');
    const div = mount(html);
    expect(pieces(div, '.vlx-ref').map((e) => e.textContent)).toEqual(['(119)', '(154)']);
    expect(pieces(div, '.vlx-mod').length).toBe(2);
    expect(pieces(div, '.vlx-notice').map((e) => e.textContent)).toEqual(['((NUMERO ABROGATO DAL D.L. 11 APRILE 2025, N. 48))']);
    expect(div.querySelector('.vlx-updates-toggle')?.textContent).toBe('');
    expect(mount(render(raw, { updatesOpen: true })).querySelector('.vlx-updates')?.getAttribute('data-open')).toBe('true');
  });

  it('a reference with no note is dimmed, not a button', () => {
    const div = mount(render(fixtureText('nrm-privacy-2ter')));
    expect(pieces(div, '.vlx-ref-missing').map((e) => e.textContent)).toEqual(['((49))']);
    expect(div.querySelector('.vlx-ref')).toBeNull();
  });

  it('hides the markdown prefix of the Akoma Ntoso fallback without dropping it', () => {
    const raw = fixtureText('akn-dlgs231-5');
    const div = mount(render(raw));
    expect(div.querySelector('.vlx-hidden')?.textContent).toBe('### ');
    expect(div.textContent).toBe(raw.replace(/\n/g, ''));
  });
});
