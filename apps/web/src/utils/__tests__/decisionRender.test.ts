import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decisionProjection, renderDecisionHtml, unmatchedAnchors } from '../decisionRender';
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

describe('renderDecisionHtml', () => {
  for (const [name, testo] of Object.entries(DECISION_TEXTS)) {
    for (const signs of [false, true]) {
      it(`${name}: the text nodes spell the projection, marks on, signs ${signs ? 'on' : 'off'}`, () => {
        const plain = decisionProjection(testo);
        const marks = plain.length > 60 ? [hl(10, plain.slice(10, 40)), hl(plain.length - 30, plain.slice(-30))] : [];
        const notes = plain.length > 60 ? [note(25, plain.slice(25, 33))] : [];
        const html = renderDecisionHtml({ testo, highlights: marks, annotations: notes, signs });
        expect(textNodes(html)).toBe(plain);
        const root = document.createElement('div');
        root.innerHTML = html;
        expect(root.innerHTML).toBe(html.replace(/\u00a0/g, '&nbsp;')); // kept as written (only nbsp is serialised as an entity): well-formed
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
        const marks = [hl(0, plain.slice(0, 20)), hl(Math.max(0, plain.length - 20), plain.slice(-20))];
        expect(textNodes(renderDecisionHtml({ testo, highlights: marks, annotations: [], signs }))).toBe(plain);
      }
    });
  }

  it('every reader-derived fixture has a golden entry', () => {
    expect(Object.keys(READER_TEXTS).filter((k) => !(k in golden))).toEqual([]);
  });
});
