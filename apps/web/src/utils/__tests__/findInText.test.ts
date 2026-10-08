import { describe, it, expect } from 'vitest';
import { renderArticleHtml } from '../articleRender';
import { parseArticleStructure } from '../articleStructure';
import { renderDecisionHtml } from '../decisionRender';
import { sanitizeHTML } from '../sanitizeHtml';
import {
  foldForSearch,
  findMatches,
  collectSearchableText,
  rangesForMatches,
} from '../findInText';

describe('foldForSearch', () => {
  it('keeps the length for every kind of input', () => {
    for (const s of ['Perché', 'PERCHÈ', 'ß', 'İstanbul', 'a😀b', 'a b', 'é', 'dell’articolo']) {
      expect(foldForSearch(s).length).toBe(s.length);
    }
  });

  it('ignores case and accents', () => {
    expect(foldForSearch('PERCHÉ')).toBe('perche');
    expect(foldForSearch('Perchè')).toBe('perche');
  });

  it('reads typographic apostrophes and Unicode spaces as ASCII', () => {
    expect(foldForSearch('dell’articolo')).toBe("dell'articolo");
    expect(foldForSearch('a b c')).toBe('a b c');
  });

  it('leaves ß and astral characters as they are; İ folds to one unit', () => {
    expect(foldForSearch('ß')).toBe('ß');
    expect(foldForSearch('İ')).toBe('i');
    expect(foldForSearch('😀')).toBe('😀');
  });
});

describe('findMatches', () => {
  it('finds a decomposed accent in the text, the mark inside the range', () => {
    const text = 'Perche\u0301 no? Perche\u0301.';
    for (const q of ['perche', 'perché', 'perche\u0301']) {
      expect(findMatches(text, q).matches.map(([s, e]) => text.slice(s, e))).toEqual([
        'Perche\u0301',
        'Perche\u0301',
      ]);
    }
    const two = findMatches(text, 'perche no');
    expect(two.matches.map(([s, e]) => text.slice(s, e))).toEqual(['Perche\u0301 no']);
  });

  it('finds precomposed text with a decomposed query', () => {
    const text = 'Perché no';
    expect(findMatches(text, 'perche\u0301 no').matches).toEqual([[0, 9]]);
  });

  it('finds a no-break space in the text and the other apostrophes', () => {
    const text = 'il danno\u00a0ingiusto e dell´art. e dell`art.';
    expect(findMatches(text, 'danno ingiusto').matches).toEqual([[3, 17]]);
    expect(findMatches(text, "dell'art").matches).toHaveLength(2);
  });

  it('ignores a soft hyphen or a zero-width space inside a word', () => {
    const text = 'respon\u00adsabilità e respon\u200bsabilita';
    expect(findMatches(text, 'responsabilita').matches).toEqual([[0, 15], [18, 33]]);
  });

  it('does not match ligatures', () => {
    expect(findMatches('e\ufb03cace', 'efficace').matches).toEqual([]);
  });

  it('counts the two-character minimum in folded base characters', () => {
    expect(findMatches('x😀y é', '😀').matches).toEqual([]);
    expect(findMatches('e\u0301 e', 'e\u0301').matches).toEqual([]);
    expect(findMatches('x😀y', '😀y').matches).toEqual([[1, 4]]);
  });

  it('finds accented forms with an unaccented query, at the original offsets', () => {
    const text = 'Perché no? PERCHÉ sì. Perchè.';
    const { matches, truncated } = findMatches(text, 'perche');
    expect(truncated).toBe(false);
    expect(matches.map(([s, e]) => text.slice(s, e))).toEqual(['Perché', 'PERCHÉ', 'Perchè']);
  });

  it('finds an apostrophe across typographies', () => {
    const text = 'dell’articolo';
    expect(findMatches(text, "dell'articolo").matches).toEqual([[0, text.length]]);
  });

  it('matches a whitespace run in the query against any run in the text', () => {
    const text = 'il danno    ingiusto';
    expect(findMatches(text, 'danno ingiusto').matches).toEqual([[3, text.length]]);
    expect(findMatches('danno ingiusto', 'danno    ingiusto').matches).toHaveLength(1);
  });

  it('trims the query and finds nothing under two characters', () => {
    expect(findMatches('a b a', 'a').matches).toEqual([]);
    expect(findMatches('a b a', '  a ').matches).toEqual([]);
    expect(findMatches('ab', ' ab ').matches).toEqual([[0, 2]]);
    expect(findMatches('ab', '').matches).toEqual([]);
  });

  it('treats regex characters as plain text', () => {
    expect(findMatches('a.b axb', 'a.b').matches).toEqual([[0, 3]]);
    expect(findMatches('(x)', '(x)').matches).toEqual([[0, 3]]);
  });

  it('caps at the limit and says so', () => {
    const text = 'ab '.repeat(1500);
    const r = findMatches(text, 'ab');
    expect(r.matches).toHaveLength(1000);
    expect(r.truncated).toBe(true);
    const exact = findMatches('ab '.repeat(3), 'ab', { limit: 3 });
    expect(exact.matches).toHaveLength(3);
    expect(exact.truncated).toBe(false);
  });
});

describe('DOM collection', () => {
  function root(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  it('turns a match split by a mark and a sign into one range of the original words', () => {
    const el = root('<p>Il danno <mark>ingiusto</mark><span class="vlx-sign"></span> e grave</p>');
    const { nodes, text } = collectSearchableText(el);
    expect(text).toBe('Il danno ingiusto e grave');
    const { matches } = findMatches(text, 'danno INGIUSTO e');
    const ranges = rangesForMatches(nodes, matches);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('danno ingiusto e');
    el.remove();
  });

  it('maps a range across a node boundary and over an empty node', () => {
    const el = root('<p>ab</p>');
    const p = el.firstElementChild as HTMLElement;
    p.appendChild(document.createTextNode(''));
    p.appendChild(document.createTextNode('cd'));
    const { nodes, text } = collectSearchableText(el);
    expect(text).toBe('abcd');
    const ranges = rangesForMatches(nodes, findMatches(text, 'bc').matches);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('bc');
    expect(ranges[0].startContainer).toBe(nodes[0].node);
    expect(ranges[0].endContainer).toBe(nodes[2].node);
    const whole = rangesForMatches(nodes, findMatches(text, 'abcd').matches);
    expect(whole[0].toString()).toBe('abcd');
    el.remove();
  });

  it('keeps several sorted matches across nodes in order', () => {
    const el = root('<p>ab<b>ab</b>ab</p>');
    const { nodes, text } = collectSearchableText(el);
    const ranges = rangesForMatches(nodes, findMatches(text, 'ab').matches);
    expect(ranges.map((r) => r.toString())).toEqual(['ab', 'ab', 'ab']);
    expect(ranges[1].startContainer).toBe(nodes[1].node);
    el.remove();
  });

  it('skips text hidden by a stylesheet rule', () => {
    const style = document.createElement('style');
    style.textContent = '.vlx-test-hidden { display: none; }';
    document.head.appendChild(style);
    const el = root('<p>visibile <span class="vlx-test-hidden">nascosto</span> fine</p>');
    const { text } = collectSearchableText(el);
    expect(text).not.toContain('nascosto');
    expect(findMatches(text, 'visibile fine').matches).toHaveLength(1);
    el.remove();
    style.remove();
  });

  it('is bounded by a fragment root', () => {
    const frag = document.createDocumentFragment();
    const p = document.createElement('p');
    p.textContent = 'solo qui';
    frag.appendChild(p);
    expect(collectSearchableText(frag).text).toBe('solo qui');
  });

  it('puts a space at block boundaries, at a br and at a skipped hidden span', () => {
    const el = root('<p>Fatto</p><p>Diritto</p><p>uno<br>due</p><p>tre<span style="display:none">x</span>quattro</p>');
    const { text, nodes } = collectSearchableText(el);
    expect(text).toBe('Fatto Diritto uno due tre quattro');
    expect(findMatches(text, 'fatto diritto').matches).toHaveLength(1);
    expect(findMatches(text, 'todi').matches).toEqual([]);
    expect(findMatches(text, 'tre quattro').matches).toHaveLength(1);
    const r = rangesForMatches(nodes, findMatches(text, 'fatto diritto').matches);
    expect(r[0].toString()).toBe('FattoDiritto');
    el.remove();
  });

  it('works on a rendered decision: blocks and lines are separated', () => {
    const html = renderDecisionHtml({
      testo: { motivazione: 'Fatto\n\nDiritto sulla questione\ndella prova.' },
      highlights: [],
      annotations: [],
    });
    const el = root(html);
    const { text } = collectSearchableText(el);
    expect(findMatches(text, 'fatto diritto').matches).toHaveLength(1);
    expect(findMatches(text, 'todi').matches).toEqual([]);
    expect(findMatches(text, 'questione della').matches).toHaveLength(1);
    el.remove();
  });

  it('works on a rendered article: blocks are separated', () => {
    const raw = 'Art. 5\n\n(Rubrica del testo)\n\n1. Il primo comma.\n\n2. Il secondo comma.';
    const el = root(
      sanitizeHTML(renderArticleHtml({ raw, structure: parseArticleStructure(raw), highlights: [], annotations: [] })),
    );
    const { text, nodes } = collectSearchableText(el);
    expect(findMatches(text, 'comma. 2. il').matches).toHaveLength(1);
    expect(findMatches(text, 'mma2').matches).toEqual([]);
    expect(rangesForMatches(nodes, findMatches(text, 'rubrica del testo').matches)[0].toString()).toBe('Rubrica del testo');
    el.remove();
  });

  it('skips text inside a display:none element, up to the root', () => {
    const el = root('<p>visibile</p><div style="display:none"><p>nascosto <b>qui</b></p></div>');
    const { text } = collectSearchableText(el);
    expect(text).toBe('visibile');
    el.remove();
  });

  it('does not change the root', () => {
    const el = root('<p>Il danno <mark>ingiusto</mark></p>');
    const before = el.innerHTML;
    const { nodes, text } = collectSearchableText(el);
    rangesForMatches(nodes, findMatches(text, 'danno').matches);
    expect(el.innerHTML).toBe(before);
    el.remove();
  });
});
