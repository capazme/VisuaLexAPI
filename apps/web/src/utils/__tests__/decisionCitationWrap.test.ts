import { describe, expect, it } from 'vitest';
import { wrapCitationsInHtml } from '../citationMatcher';
import { decisionReferenceOfPath, isSameDecisionTarget, wrapDecisionCitationsInHtml } from '../decisionCitationMatcher';
import { decisionPath } from '../decisionLinks';
import { decisionProjection, renderDecisionHtml } from '../decisionRender';
import { renderArticleHtml } from '../articleRender';
import { parseArticleStructure } from '../articleStructure';
import { sanitizeHTML } from '../sanitizeHtml';
import { DECISION_TEXTS } from '../__fixtures__/decisionTexts';
import { ARTICLE_FIXTURES } from '../__fixtures__/articleTexts';
import type { Highlight } from '../../types';

const NOW = new Date('2026-10-05T12:00:00Z');
const wrap = (html: string, options = {}) => wrapDecisionCitationsInHtml(html, { now: NOW, ...options });
const mount = (html: string): HTMLElement => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};
const cites = (html: string) => [...mount(html).querySelectorAll('.decision-cite')];
const hl = (startOffset: number, text: string): Highlight =>
  ({ id: `h${startOffset}`, text, startOffset, color: 'yellow', normaKey: 'k', articleId: '', rangeSerialized: '' }) as unknown as Highlight;

describe('wrapDecisionCitationsInHtml', () => {
  it('wraps a citation in a span with its address, adding no character', () => {
    const html = '<div class="vlx-b">Vedi Cass. civ., sez. III, n. 12789/2022 per il danno.</div>';
    const out = wrap(html);
    expect(out).toBe(
      '<div class="vlx-b">Vedi <span class="decision-cite" data-decision-path="/sentenze/cassazione-civile/12789/2022?sezione=III" '
      + 'data-cache-key="/sentenze/cassazione-civile/12789/2022?sezione=III">Cass. civ., sez. III, n. 12789/2022</span> per il danno.</div>',
    );
    expect(mount(out).textContent).toBe(mount(html).textContent);
  });

  it('returns the html it was given when it cites no decision', () => {
    for (const html of ['', '<p>art. 2043 c.c.</p>', '<p>Cass. civ.</p>']) expect(wrap(html)).toBe(html);
  });

  it('escapes the address in the attribute and reads it back', () => {
    const out = wrap('<p>TAR Lazio, n. 1234/2020 e TAR Lazio, n. 1235/2020, ordinanza</p>');
    const [first] = cites(out);
    expect(first.getAttribute('data-decision-path')).toBe('/sentenze/tar/1234/2020?regione=Lazio');
    expect(out).toContain('data-decision-path="/sentenze/tar/1234/2020?regione=Lazio"');
    const tipo = wrap('<p>T.A.R. Puglia, Lecce, decr. n. 12/2023</p>');
    expect(tipo).toContain('?tipo=decreto');
    const both = wrap('<p>TAR Lazio, ord. n. 1234/2020</p>');
    expect(both).toContain('tipo=ordinanza&amp;regione=Lazio');
    expect(cites(both)[0].getAttribute('data-decision-path')).toBe('/sentenze/tar/1234/2020?tipo=ordinanza&regione=Lazio');
  });

  it('reads an address back to its reference', () => {
    expect(decisionReferenceOfPath('/sentenze/cassazione-civile/12789/2022?sezione=III', NOW)).toEqual({
      corte: 'cassazione', archivio: 'civile', numero: 12789, anno: 2022, sezione: 'III',
    });
    expect(decisionReferenceOfPath('/sentenze/tar/1234/2020?regione=Lazio', NOW)).toMatchObject({ corte: 'tar', regione: 'Lazio' });
    expect(decisionReferenceOfPath('/sentenze/nowhere/1/2020', NOW)).toBeNull();
  });

  it('wraps a citation split by a highlight in two spans with one key', () => {
    const html = '<p>Vedi Cass. civ., <mark data-highlight="h">sez. III</mark>, n. 12789/2022 qui.</p>';
    const out = wrap(html);
    const spans = cites(out);
    expect(spans.map((s) => s.textContent)).toEqual(['Cass. civ., ', 'sez. III', ', n. 12789/2022']);
    expect(new Set(spans.map((s) => s.getAttribute('data-cache-key'))).size).toBe(1);
    expect(mount(out).textContent).toBe(mount(html).textContent);
    // every opened span is closed: the html is well-formed
    expect((out.match(/<span /g) ?? []).length).toBe((out.match(/<\/span>/g) ?? []).length);
    // crossing from one span to the next is not leaving the citation
    expect(isSameDecisionTarget(spans[0], spans[1])).toBe(true);
    expect(isSameDecisionTarget(spans[0], document.body)).toBe(false);
    expect(isSameDecisionTarget(spans[0], null)).toBe(false);
  });

  it('reads an entity as the one character it is, and wraps it whole', () => {
    const html = '<p>Rossi &amp; Bianchi: Cass.&nbsp;civ., sez. III, n.&nbsp;12789/2022 &lt;fine&gt;</p>';
    const out = wrap(html);
    expect(cites(out).map((s) => s.textContent)).toEqual(['Cass. civ., sez. III, n. 12789/2022']);
    expect(mount(out).textContent).toBe(mount(html).textContent);
    expect(out).toContain('Rossi &amp; Bianchi: <span');
  });

  it('decodes the entities before scanning: an encoded apostrophe and an encoded no-break space', () => {
    // «Corte d&#39;appello» is seen as a court, so the section after it is not the Cassazione's
    expect(cites(wrap('<p>La Corte d&#39;appello di Roma, sez. lav., n. 1234/2019</p>', { within: 'cassazione' }))).toHaveLength(0);
    // a semicolon of an entity does not end the tail
    const out = wrap('<p>Cass.&#160;civ., sez.&nbsp;III, n.&#xA0;12789/2022 &amp; Corte&nbsp;cost. n. 71/2020</p>');
    expect(cites(out).map((e) => e.textContent)).toEqual(['Cass.\u00a0civ., sez.\u00a0III, n.\u00a012789/2022', 'Corte\u00a0cost. n. 71/2020']);
    expect(mount(out).textContent).toBe(mount('<p>Cass.&#160;civ., sez.&nbsp;III, n.&#xA0;12789/2022 &amp; Corte&nbsp;cost. n. 71/2020</p>').textContent);
  });

  it('decodes every entity as the browser does, never as a space', () => {
    // «Corte d&rsquo;appello» is a court whatever its apostrophe is written as
    expect(cites(wrap('<p>La Corte d&rsquo;appello di Roma, sez. lav., n. 1/2020</p>', { within: 'cassazione' }))).toHaveLength(0);
    expect(cites(wrap('<p>La Corte d&#x2019;appello di Roma, sez. lav., n. 1/2020</p>', { within: 'cassazione' }))).toHaveLength(0);
    // a named entity inside a citation keeps the span, and a soft hyphen cuts nothing
    const html = '<p>T.A.R. Valle d&rsquo;Aosta, n. 5/2020 e Cass. n. 6/20&shy;20, cos&igrave; &agrave; Corte cost. n. 71/2020</p>';
    const out = wrap(html);
    expect(cites(out).map((e) => e.textContent)).toEqual(['T.A.R. Valle d’Aosta, n. 5/2020', 'Cass. n. 6/20\u00ad20', 'Corte cost. n. 71/2020']);
    expect(mount(out).textContent).toBe(mount(html).textContent);
    expect(cites(out)[1].getAttribute('data-decision-path')).toBe('/sentenze/cassazione/6/2020');
  });

  it('does not read a citation across two blocks', () => {
    expect(wrap('<div>Cass. civ.</div><div>n. 12789/2022</div>')).toBe('<div>Cass. civ.</div><div>n. 12789/2022</div>');
    // a line break inside a paragraph is not a paragraph break
    expect(new Set(cites(wrap('<div>Cass. civ.,<br>n. 12789/2022</div>')).map((s) => s.getAttribute('data-cache-key'))).size).toBe(1);
  });

  it('reads a word or a number a mark cuts as the one it is', () => {
    const out = wrap('<p>Cass. civ. n. 12<mark>789/20</mark>22 e T-6<mark>12</mark>/17</p>');
    expect(cites(out).map((s) => s.textContent)).toEqual(['Cass. civ. n. 12', '789/20', '22', 'T-6', '12', '/17']);
    expect(mount(out).textContent).toBe('Cass. civ. n. 12789/2022 e T-612/17');
  });

  describe('beside the norm links', () => {
    it('claims no character a norm link holds', () => {
      const html = wrapCitationsInHtml('<p>Vedi art. 2043 c.c. e Cass. n. 5/2020, nonché l\'art. 3 Cost.</p>');
      const out = wrap(html);
      expect(cites(out).map((s) => s.textContent)).toEqual(['Cass. n. 5/2020']);
      expect(mount(out).querySelectorAll('.citation-hover')).toHaveLength(mount(html).querySelectorAll('.citation-hover').length);
      for (const decision of mount(out).querySelectorAll('.decision-cite')) expect(decision.closest('.citation-hover')).toBeNull();
      expect(mount(out).textContent).toBe(mount(html).textContent);
    });

    it('leaves a whole decision span out when it would touch a norm link', () => {
      const norm = '<span class="citation-hover" data-citation="{}" data-cache-key="k">n. 5/2020</span>';
      const html = `<p>Cass. ${norm} e Corte cost. n. 71/2020</p>`;
      expect(cites(wrap(html)).map((s) => s.textContent)).toEqual(['Corte cost. n. 71/2020']);
    });
  });

  describe('selfPath', () => {
    const html = '<p>Questa Cass. civ., sez. III, n. 12789/2022 e Corte cost. n. 71/2020.</p>';

    it('does not link a decision to itself', () => {
      const self = decisionPath({ corte: 'cassazione', archivio: 'civile', numero: 12789, anno: 2022 });
      expect(cites(wrap(html, { selfPath: self })).map((s) => s.textContent)).toEqual(['Corte cost. n. 71/2020']);
    });

    it('a citation without the archive is the same decision', () => {
      const bare = '<p>Cass. n. 12789/2022 e Corte cost. n. 71/2020.</p>';
      expect(cites(wrap(bare, { selfPath: '/sentenze/cassazione-penale/12789/2022' })).map((s) => s.textContent)).toEqual(['Corte cost. n. 71/2020']);
    });

    it('another archive is another decision', () => {
      expect(cites(wrap(html, { selfPath: '/sentenze/cassazione-penale/12789/2022' }))).toHaveLength(2);
      expect(cites(wrap(html, { selfPath: '/sentenze/corte-costituzionale/12789/2022' }))).toHaveLength(2);
    });

    it('another number or year is another decision', () => {
      expect(cites(wrap(html, { selfPath: '/sentenze/cassazione-civile/12788/2022' }))).toHaveLength(2);
      expect(cites(wrap(html, { selfPath: '/sentenze/cassazione-civile/12789/2021' }))).toHaveLength(2);
    });
  });

  describe('within', () => {
    const html = '<p>Cfr. Sez. U, n. 9100 del 2015 e Sez. 3, n. 5/2020.</p>';

    it('reads a section without a court only inside a Cassazione decision', () => {
      expect(cites(wrap(html))).toHaveLength(0);
      expect(cites(wrap(html, { within: 'cassazione' })).map((s) => s.textContent)).toEqual(['Sez. U, n. 9100 del 2015', 'Sez. 3, n. 5/2020']);
    });
  });
});

// --- root rule 23: both kinds of link on, the text nodes still spell the text ---

const CITED = 'Cfr. Cass. civ., sez. III, n. 12789/2022 e Sez. U, n. 9100 del 2015; Corte cost. n. 71/2020 (art. 3 Cost.), C-634/21 & T-612/17 <b>.';

describe('root rule 23 with the norm links and the decision links on', () => {
  for (const [name, testo] of Object.entries(DECISION_TEXTS)) {
    it(`${name}: the text nodes spell the projection, a citation cut by a mark included`, () => {
      const cited = { ...testo, motivazione: `${testo.motivazione ?? ''}\n\n${CITED}` };
      const plain = decisionProjection(cited);
      const at = plain.indexOf('sez. III');
      const highlights = [hl(at, 'sez. III'), hl(plain.indexOf('C-634'), 'C-634/21 & T-6')];
      const html = wrapDecisionCitationsInHtml(
        wrapCitationsInHtml(renderDecisionHtml({ testo: cited, highlights, annotations: [], signs: true })),
        { within: 'cassazione', now: NOW },
      );
      expect(mount(html).textContent).toBe(plain);
      const keys = cites(html).map((s) => s.getAttribute('data-decision-path'));
      expect(keys).toContain('/sentenze/cassazione-civile/12789/2022?sezione=III');
      expect(keys).toContain('/sentenze/cassazione/9100/2015?sezione=U');
      expect(keys).toContain('/sentenze/corte-costituzionale/71/2020');
      expect(keys).toContain('/sentenze/corte-giustizia-ue/634/2021');
      expect(keys).toContain('/sentenze/tribunale-ue/612/2017');
    });
  }

  for (const f of ARTICLE_FIXTURES) {
    it(`${f.id}: the text nodes spell article_text minus \\n`, () => {
      const raw = `${f.text}\n\nSi vedano ${CITED}`;
      const plain = raw.replace(/\n/g, '');
      const at = plain.indexOf('sez. III');
      const html = wrapDecisionCitationsInHtml(
        wrapCitationsInHtml(renderArticleHtml({ raw, structure: parseArticleStructure(raw), highlights: [hl(at, 'sez. III')], annotations: [] })),
        { now: NOW },
      );
      const div = mount(sanitizeHTML(html));
      expect(div.textContent).toBe(plain);
      expect([...div.querySelectorAll('.decision-cite')].map((s) => s.getAttribute('data-decision-path'))).toContain('/sentenze/cassazione-civile/12789/2022?sezione=III');
    });
  }

  it('links the Corte costituzionale an update note cites (c.p. 640)', () => {
    const f = ARTICLE_FIXTURES.find((a) => a.id === 'nrm-cp-640')!;
    const html = wrapDecisionCitationsInHtml(wrapCitationsInHtml(renderArticleHtml({ raw: f.text, structure: parseArticleStructure(f.text), highlights: [], annotations: [] })));
    expect(cites(html).map((s) => s.getAttribute('data-decision-path'))).toEqual(['/sentenze/corte-costituzionale/272/1997']);
    expect(mount(html).textContent).toBe(f.text.replace(/\n/g, ''));
  });
});

describe('wrapDecisionCitationsInHtml, a long decision', () => {
  it('wraps 300 000 characters of paragraphs, citations among them, in a bounded time', () => {
    const paragraph = '<p class="vlx-dec-para">Il ricorso richiama Cass. civ., sez. III, n. 12789/2022 e la legge 7 agosto 1990, n. 241, nonché &amp; altro testo che riempie il paragrafo.</p>';
    const html = paragraph.repeat(Math.ceil(300_000 / paragraph.length));
    const start = performance.now();
    const out = wrapDecisionCitationsInHtml(html, { within: 'cassazione', now: NOW });
    const elapsed = performance.now() - start;
    expect(elapsed, `${elapsed.toFixed(0)} ms`).toBeLessThan(1500);
    expect((out.match(/class="decision-cite"/g) ?? []).length).toBe(html.split('Cass. civ.').length - 1);
  });
});
