import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decisionProjection, decisionStructure, isAnchoredNote, renderDecisionHtml, unmatchedAnchors } from '../decisionRender';
import { DECISION_TEXTS, READER_TEXTS } from '../__fixtures__/decisionTexts';
import type { Annotation, Highlight } from '../../types';

function textNodes(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n.nodeValue ?? '');
  return out.join('');
}

const hl = (startOffset: number, text: string, id = `h${startOffset}`) =>
  ({ id, text, startOffset, color: 'yellow', normaKey: 'k', articleId: '', range: '', createdAt: '' }) as unknown as Highlight;
const note = (startOffset: number, anchorText: string, id = `n${startOffset}`) =>
  ({ id, text: 'una nota', anchorText, startOffset, normaKey: 'k', articleId: '', createdAt: '' }) as unknown as Annotation;

function findGolden(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'services', 'visualex', 'tests', 'fixtures', 'decisions', 'frozen_projections.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('frozen_projections.json not found above ' + from);
  }
}

/** An offset moved off the middle of a surrogate pair, so a mark never cuts a character in two. */
const whole = (plain: string, i: number): number => (i > 0 && i < plain.length && /[\udc00-\udfff]/.test(plain[i]) ? i - 1 : i);

/**
 * Marks and a note on any text, short or long: the head, the tail, one over the first special
 * character (no-break space, `<`, `&`, `\r`, an astral one), one across the first paragraph
 * boundary (a block boundary where the text has two blocks), and a note in the middle.
 */
function marksOn(testo: Parameters<typeof decisionProjection>[0]) {
  const plain = decisionProjection(testo);
  const n = plain.length;
  const span = (from: number, to: number, id: string) => {
    const a = whole(plain, Math.max(0, from));
    const b = whole(plain, Math.min(n, to));
    return hl(a, plain.slice(a, b), id);
  };
  const highlights = [span(0, 10, 'head'), span(n - 10, n, 'tail')];
  const special = /[\u00a0<&\r]|[\ud800-\udbff][\udc00-\udfff]/.exec(plain);
  if (special) highlights.push(span(special.index - 2, special.index + special[0].length + 2, 'special'));
  const blocks = decisionStructure(testo).blocks;
  if (blocks.length > 1) highlights.push(span(blocks[0].end - 3, blocks[1].start + 3, 'cross'));
  const mid = whole(plain, Math.floor(n / 2));
  const end = whole(plain, Math.min(n, mid + 5));
  const annotations = n > 0 ? [note(mid, plain.slice(mid, end), 'mid')] : [];
  return { plain, highlights: n > 0 ? highlights : [], annotations };
}

describe('renderDecisionHtml', () => {
  for (const [name, testo] of Object.entries(DECISION_TEXTS)) {
    for (const signs of [false, true]) {
      it(`${name}: the text nodes spell the projection, marks on, signs ${signs ? 'on' : 'off'}`, () => {
        const { plain, highlights, annotations } = marksOn(testo);
        const html = renderDecisionHtml({ testo, highlights, annotations, signs });
        expect(textNodes(html)).toBe(plain);
        const root = document.createElement('div');
        root.innerHTML = html;
        expect(root.innerHTML).toBe(html.replace(/\u00a0/g, '&nbsp;').replace(/&#13;/g, '\r')); // kept as written (only nbsp is serialised as an entity): well-formed
      });

      it(`${name}: every mark placed lands, and with signs on each annotated paragraph has its sign`, () => {
        const { highlights, annotations } = marksOn(testo);
        expect(unmatchedAnchors(testo, highlights, annotations)).toEqual({ highlights: [], annotations: [] });
        const root = document.createElement('div');
        root.innerHTML = renderDecisionHtml({ testo, highlights, annotations, signs });
        const annotated = new Set<number>();
        const touch = (start: number, end: number) => decisionStructure(testo).blocks.forEach((b, i) => {
          if (start < b.end && end > b.start) annotated.add(i);
        });
        highlights.forEach((h) => touch(h.startOffset ?? 0, (h.startOffset ?? 0) + h.text.length));
        annotations.forEach((a) => touch(a.startOffset ?? 0, (a.startOffset ?? 0) + (a.anchorText?.length ?? 0)));
        const drawn = [...root.querySelectorAll<HTMLElement>('.vlx-sign')].map((e) => Number(e.dataset.block));
        expect(signs ? drawn.sort((a, b) => a - b) : drawn).toEqual(signs ? [...annotated].sort((a, b) => a - b) : []);
      });
    }
  }

  it('a block whose edges carry spaces renders its stripped text', () => {
    const testo = { epigrafe: '  \n Epi grafe \n', motivazione: '\n\n  Motiva zione.  \n', dispositivo: '\tDispo.\n' };
    expect(decisionProjection(testo)).toBe('Epi grafeMotiva zione.Dispo.');
    expect(textNodes(renderDecisionHtml({ testo, highlights: [hl(9, 'Motiva')], annotations: [] }))).toBe('Epi grafeMotiva zione.Dispo.');
  });

  it('does not strip a no-break space at a block edge', () => {
    const plain = decisionProjection({ motivazione: ' x ' });
    expect(plain).toBe(' x ');
    expect(textNodes(renderDecisionHtml({ testo: { motivazione: ' x ' }, highlights: [], annotations: [] }))).toBe(plain);
  });

  it('a decision whose text looks like a placeholder or an entity comes out unchanged', () => {
    const testo = { motivazione: '%SIGN0% &amp; &lt;b&gt;' };
    expect(textNodes(renderDecisionHtml({ testo, highlights: [], annotations: [], signs: true }))).toBe('%SIGN0% &amp; &lt;b&gt;');
  });

  it('a highlight across two blocks renders in both, and the HTML stays well-formed', () => {
    const testo = { motivazione: 'Primo paragrafo.\n\nSecondo.', dispositivo: 'P.Q.M. rigetta.' };
    const plain = decisionProjection(testo);
    const start = plain.indexOf('Secondo');
    const html = renderDecisionHtml({ testo, highlights: [hl(start, plain.slice(start, start + 14))], annotations: [] });
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.innerHTML).toBe(html);
    expect(root.querySelectorAll('mark').length).toBe(2);
    expect([...root.querySelectorAll('mark')].map((m) => m.textContent).join('')).toBe('Secondo.P.Q.M.');
  });

  it('a highlight across lines of one paragraph is cut at each line', () => {
    const testo = { motivazione: 'uno due\ntre quattro\ncinque' };
    const html = renderDecisionHtml({ testo, highlights: [hl(4, 'duetre quattrocin')], annotations: [] });
    const root = document.createElement('div');
    root.innerHTML = html;
    expect([...root.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['due', 'tre quattro', 'cin']);
    expect(root.querySelectorAll('.vlx-dec-line').length).toBe(3);
  });

  it('uses the article marks, so the same CSS and handlers apply', () => {
    const testo = { motivazione: 'Il ricorso è fondato.' };
    const html = renderDecisionHtml({ testo, highlights: [hl(3, 'ricorso')], annotations: [note(3, 'ricorso')] });
    expect(html).toContain('class="highlight-mark"');
    expect(html).toContain('data-highlight="h3"');
    expect(html).toContain('class="note-anchor"');
    expect(html).toContain('data-note-id="n3"');
  });

  it('escapes the text', () => {
    const html = renderDecisionHtml({ testo: { motivazione: '<img src=x onerror=alert(1)> & "q"' }, highlights: [], annotations: [] });
    expect(html).not.toContain('<img');
    expect(textNodes(html)).toBe('<img src=x onerror=alert(1)> & "q"');
  });

  describe('signs', () => {
    const testo = { motivazione: 'Primo paragrafo.\n\nSecondo paragrafo.\n\nTerzo.', dispositivo: 'Rigetta.' };
    const plain = decisionProjection(testo);

    it('ends each annotated paragraph with an empty sign, counted per paragraph', () => {
      const at = plain.indexOf('Secondo');
      const html = renderDecisionHtml({
        testo,
        highlights: [hl(at, 'Secondo')],
        annotations: [note(at + 2, 'condo p')],
        signs: true,
      });
      const root = document.createElement('div');
      root.innerHTML = html;
      const signs = [...root.querySelectorAll<HTMLElement>('.vlx-sign')];
      expect(signs.length).toBe(1);
      expect(signs[0].dataset.block).toBe('1');
      expect(signs[0].dataset.notes).toBe('1');
      expect(signs[0].dataset.highlights).toBe('1');
      expect(signs[0].textContent).toBe('');
      expect(signs[0].parentElement?.className).toBe('vlx-dec-para');
      expect(signs[0].closest('mark, .note-anchor')).toBeNull();
    });

    it('a highlight across two paragraphs gives a sign to both; none without signs on', () => {
      const at = plain.indexOf('paragrafo.Secondo');
      const marks = [hl(at, 'paragrafo.Secondo')];
      const root = document.createElement('div');
      root.innerHTML = renderDecisionHtml({ testo, highlights: marks, annotations: [], signs: true });
      expect(root.querySelectorAll('.vlx-sign').length).toBe(2);
      expect(renderDecisionHtml({ testo, highlights: marks, annotations: [] })).not.toContain('vlx-sign');
    });

    it('an anchor that does not land makes no sign', () => {
      const html = renderDecisionHtml({ testo, highlights: [hl(3, 'testo cambiato', 'gone')], annotations: [], signs: true });
      expect(html).not.toContain('vlx-sign');
    });
  });
});

describe('unmatchedAnchors', () => {
  it('lists what does not land, never drops it', () => {
    const testo = { motivazione: 'Il ricorso è fondato.' };
    const gone = hl(3, 'testo cambiato', 'gone');
    const lost = note(3, 'altro', 'lost');
    const out = unmatchedAnchors(testo, [gone, hl(3, 'ricorso', 'ok')], [lost, note(3, 'ricorso', 'okn')]);
    expect(out.highlights).toEqual([gone]);
    expect(out.annotations).toEqual([lost]);
  });

  it('lists a note with a quote but no offset: it is anchored, and cannot land', () => {
    const quoting = { id: 'q', text: 'nota', normaKey: 'k', articleId: '', createdAt: '', anchorText: 'ricorso' } as unknown as Annotation;
    expect(isAnchoredNote(quoting)).toBe(true);
    expect(unmatchedAnchors({ motivazione: 'Il ricorso è fondato.' }, [], [quoting]).annotations).toEqual([quoting]);
  });

  it('never lists a free note: it has no anchor to lose', () => {
    const free = { id: 'free', text: 'una nota', normaKey: 'k', articleId: '', createdAt: '' } as unknown as Annotation;
    expect(unmatchedAnchors({ motivazione: 'Il ricorso è fondato.' }, [], [free])).toEqual({ highlights: [], annotations: [] });
    expect(unmatchedAnchors({}, [], [free])).toEqual({ highlights: [], annotations: [] });
  });

  it('a decision without its text lists every anchor', () => {
    const all = [hl(0, 'x')];
    const notes = [note(0, 'x')];
    expect(unmatchedAnchors({}, all, notes)).toEqual({ highlights: all, annotations: notes });
  });
});

describe('the web projection is the API projection', () => {
  const golden = JSON.parse(readFileSync(findGolden(__dirname), 'utf8')) as Record<string, { sha256: string; length: number }>;

  for (const [key, testo] of Object.entries(READER_TEXTS)) {
    it(`${key}: SHA-256 and length equal the API's golden, signs on or off`, () => {
      const plain = decisionProjection(testo);
      // the golden counts Python code points, a JS string counts UTF-16 units
      expect({ sha256: createHash('sha256').update(plain, 'utf8').digest('hex'), length: [...plain].length }).toEqual(golden[key]);
      for (const signs of [false, true]) {
        const { highlights, annotations } = marksOn(testo);
        expect(textNodes(renderDecisionHtml({ testo, highlights, annotations, signs }))).toBe(plain);
      }
    });
  }

  it('every reader-derived fixture has a golden entry, and every synthetic golden entry a fixture', () => {
    expect(Object.keys(READER_TEXTS).filter((k) => !(k in golden))).toEqual([]);
    // the golden also holds real and open-data cases the web must not carry; the synthetic ones it must
    expect(Object.keys(golden).filter((k) => k.startsWith('synthetic_') && !(k in READER_TEXTS))).toEqual([]);
  });

  it('the astral case tells code points from UTF-16 units', () => {
    const plain = decisionProjection(READER_TEXTS.synthetic_field_astral);
    expect(plain.length).toBe([...plain].length + 2);
    expect(golden.synthetic_field_astral.length).toBe([...plain].length);
  });
});

describe('decisionStructure', () => {
  const testo = DECISION_TEXTS.wraps_and_paragraphs;

  it('is the same list every time, whatever the anchors, and the renderer numbers its signs by it', () => {
    expect(decisionStructure(testo)).toEqual(decisionStructure({ ...testo }));
    const { blocks } = decisionStructure(testo);
    const plain = decisionProjection(testo);
    expect(blocks.length).toBe(4); // three paragraphs of the motivazione, one of the dispositivo
    expect(blocks.map((b) => plain.slice(b.start, b.end))[1]).toBe('  Secondo paragrafo con rientro.');
    const at = plain.indexOf('Terzo');
    for (const marks of [[], [hl(at, 'Terzo')]]) {
      const root = document.createElement('div');
      root.innerHTML = renderDecisionHtml({ testo, highlights: marks, annotations: [], signs: true });
      expect(root.querySelectorAll('.vlx-dec-para').length).toBe(blocks.length);
      expect([...root.querySelectorAll<HTMLElement>('.vlx-sign')].map((s) => s.dataset.block)).toEqual(marks.length ? ['2'] : []);
    }
  });

  it('has no paragraph for a block without text', () => {
    expect(decisionStructure({}).blocks).toEqual([]);
    expect(decisionStructure({ epigrafe: '  ', motivazione: 'x' }).blocks.length).toBe(1);
  });
});

describe('labels and characters', () => {
  const labels = (html: string) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('section')].map((s) => s.dataset.label);

  it('an epigrafe is «Testo» when the stripped motivazione is empty', () => {
    expect(labels(renderDecisionHtml({ testo: { epigrafe: 'a', motivazione: ' \n\t ' }, highlights: [], annotations: [] }))).toEqual(['Testo']);
    expect(labels(renderDecisionHtml({ testo: { epigrafe: 'a', motivazione: 'b' }, highlights: [], annotations: [] }))).toEqual(['Epigrafe', 'Motivazione']);
  });

  it('writes an interior carriage return as a reference (the readers never emit one: italgiure:v4)', () => {
    const testo = DECISION_TEXTS.carriage_return;
    const html = renderDecisionHtml({ testo, highlights: [], annotations: [] });
    expect(html).toContain('&#13;');
    expect(textNodes(html)).toContain('riga uno\rriga due');
    expect(textNodes(html)).toBe(decisionProjection(testo));
  });

  it('marks that touch the special characters are really drawn', () => {
    for (const name of ['nbsp', 'astral', 'markup', 'carriage_return', 'epigrafe_only']) {
      const { highlights } = marksOn(DECISION_TEXTS[name]);
      const root = document.createElement('div');
      root.innerHTML = renderDecisionHtml({ testo: DECISION_TEXTS[name], highlights, annotations: [] });
      expect(root.querySelectorAll('mark').length, name).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('discussions: signs count threads, the focus nests, the text nodes still spell the projection', () => {
  const summary = (id: string) => ({ id, title: 't', passage: { quote: '', start: 0, prefix: '', suffix: '' }, articleUrn: null, textHash: null, commentCount: 0, createdAt: '', user: { id: 'u', username: 'x' } }) as never;

  it('draws a sign with data-threads on a paragraph holding only a discussion', () => {
    const testo = DECISION_TEXTS[Object.keys(DECISION_TEXTS).find((n) => decisionProjection(DECISION_TEXTS[n]).length > 30 && n !== 'carriage_return')!];
    const plain = decisionProjection(testo);
    const html = renderDecisionHtml({
      testo, highlights: [], annotations: [], signs: true,
      threads: [{ thread: summary('a'), start: 0, end: 5 }, { thread: summary('b'), start: 2, end: 9 }],
    });
    const root = document.createElement('div');
    root.innerHTML = html;
    const sign = root.querySelector<HTMLElement>('.vlx-sign[data-block="0"]')!;
    expect(sign.dataset.threads).toBe('2');
    expect(sign.dataset.notes).toBe('0');
    expect(textNodes(html)).toBe(plain);
  });

  it('every fixture with a discussion and its focus on: the text nodes spell the projection', () => {
    for (const [name, testo] of Object.entries(DECISION_TEXTS)) {
      const plain = decisionProjection(testo);
      if (plain === '') continue;
      const { highlights, annotations } = marksOn(testo);
      const end = Math.min(plain.length, 12);
      const html = renderDecisionHtml({
        testo, highlights, annotations, signs: true,
        threads: [{ thread: summary('t'), start: 1, end }],
        focusedThreadId: 't',
      });
      expect(textNodes(html), name).toBe(plain);
      const root = document.createElement('div');
      root.innerHTML = html;
      expect(root.querySelector('.vlx-thread-focus'), name).not.toBeNull();
    }
  });

  it('draws no focus for an unknown id', () => {
    const html = renderDecisionHtml({ testo: { motivazione: 'abcdef' }, highlights: [], annotations: [], threads: [{ thread: summary('a'), start: 0, end: 3 }], focusedThreadId: 'zz' });
    expect(html).not.toContain('vlx-thread-focus');
  });
});
