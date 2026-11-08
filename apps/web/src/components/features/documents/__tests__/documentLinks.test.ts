import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentCitation } from '../documentCandidates';
import {
  buildLinkedPaste, copyLinkedPaste, documentLinks, firstArticle, linkSpan, normKey, normsToAsk, prepareLinks,
  rowEligibility, rowNorm, settleLinks, summarizeLinks, type LinkAnswer, type LinkChoice, type LinkNorm,
} from '../documentLinks';

// The rules of spec 2026-10-31-document-hyperlinks §4 and §5.2 one by one; documentLinksCorpus.test.ts runs them whole.
const CC = { act_type: 'codice civile' };
const L241 = { act_type: 'legge', act_number: '241', date: '1990' };
const row = (fields: Partial<DocumentCitation> & Pick<DocumentCitation, 'start' | 'end' | 'article'>): DocumentCitation => ({
  state: 'resolved', act: CC, ...fields,
});
const HREF = (article: string) => `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art${article}!vig=2026-11-01`;
const ok = (article: string): LinkAnswer => ({ href: HREF(article), reason: 'ok' });
const none = new Map<number, LinkChoice>();

describe('which rows get a link (§4.1–§4.2)', () => {
  it('a row read from its own words, once its address is ok', () => {
    expect(rowEligibility(row({ start: 0, end: 5, article: '2043' }))).toMatchObject({ norm: { act_type: 'codice civile', article: '2043' } });
  });

  it('an inherited row, or one completed in bulk, only once confirmed; one chosen for itself at once', () => {
    const inherited = row({ start: 0, end: 5, article: '18', state: 'inherited', act: L241 });
    expect(rowEligibility(inherited)).toEqual({ reason: 'needs_confirmation' });
    expect(rowEligibility(inherited, { confirmed: true })).toHaveProperty('norm');
    expect(rowEligibility({ ...row({ start: 0, end: 5, article: '5' }), chosenBy: 'bulk' })).toEqual({ reason: 'needs_confirmation' });
    expect(rowEligibility({ ...row({ start: 0, end: 5, article: '5' }), chosenBy: 'row' })).toHaveProperty('norm');
  });

  it('never a row to complete, never one left out', () => {
    expect(rowEligibility(row({ start: 0, end: 5, article: '5', state: 'incomplete', act: undefined }))).toEqual({ reason: 'not_resolved' });
    expect(rowEligibility(row({ start: 0, end: 5, article: '5' }), { leftOut: true, confirmed: true })).toEqual({ reason: 'left_out' });
  });

  it('a range and «e ss.» go to their first article (Q7)', () => {
    expect(firstArticle('1362-1371')).toBe('1362');
    expect(firstArticle('21-octies')).toBe('21-octies');
    expect(rowNorm(row({ start: 0, end: 5, article: '1362-1371' }))?.article).toBe('1362');
    expect(rowNorm(row({ start: 0, end: 5, article: '167', following: true }))?.article).toBe('167');
  });

  it('carries the reading, the annex included, and nothing else', () => {
    const annexed = row({ start: 3, end: 9, article: '10', act: { act_type: 'codice del processo amministrativo', annex: '3' }, query: 'x' });
    expect(rowNorm(annexed)).toEqual({ act_type: 'codice del processo amministrativo', article: '10', annex: '3' });
    expect(rowNorm(row({ start: 0, end: 5, article: '5', act: { act_type: 'x'.repeat(121) } }))).toBeNull();
    // The act's own text, chosen by the user for an «ambiguous_part»: sent as '' and kept apart from no annex.
    const own = rowNorm(row({ start: 0, end: 5, article: '7', act: { act_type: 'legge', act_number: '1', date: '2000', annex: '' } }))!;
    expect(own.annex).toBe('');
    expect(normKey(own)).not.toBe(normKey({ ...own, annex: undefined }));
  });

  it('asks each distinct norm once, none already answered; what the source left silent only on «Riprova»', () => {
    const rows = [
      row({ start: 0, end: 5, article: '2043' }),
      row({ start: 10, end: 15, article: '2043', act: { act_type: 'Codice Civile' } }),
      row({ start: 20, end: 25, article: '1218' }),
      row({ start: 30, end: 35, article: '7', state: 'inherited', act: L241 }),
    ];
    expect(normsToAsk(rows, none).map((n) => n.article)).toEqual(['2043', '1218']);
    const known = new Map<string, LinkAnswer>([
      [normKey({ act_type: 'codice civile', article: '2043' }), ok('2043')],
      [normKey({ act_type: 'codice civile', article: '1218' }), { href: null, reason: 'source_unavailable' }],
    ]);
    expect(normsToAsk(rows, none, known)).toEqual([]);
    expect(normsToAsk(rows, none, known, true).map((n) => n.article)).toEqual(['1218']);
    expect(normsToAsk(rows, new Map([[3, { confirmed: true }]]), known).map((n) => n.article)).toEqual(['7']);
  });
});

describe('the answers (§4.3)', () => {
  const rows = [row({ start: 0, end: 5, article: '2043' }), row({ start: 6, end: 9, article: '9999' })];
  const key = (article: string) => normKey({ act_type: 'codice civile', article });

  it('links with the server’s address, and says why not otherwise', () => {
    const links = settleLinks(rows, none, new Map([[key('2043'), ok('2043')], [key('9999'), { href: null, reason: 'article_missing' }]]));
    expect(links[0]).toMatchObject({ linked: true, href: HREF('2043') });
    expect(links[1]).toMatchObject({ linked: false, reason: 'article_missing' });
  });

  it('drops an address that is not an https page of Normattiva or EUR-Lex, even from the server', () => {
    for (const href of ['javascript:alert(1)', 'http://www.normattiva.it/x', 'https://evil.example/x', 'https://normattiva.it.evil.example/']) {
      const [link] = settleLinks([rows[0]], none, new Map([[key('2043'), { href, reason: 'ok' }]]));
      expect(link, href).toMatchObject({ linked: false, reason: 'invalid_address' });
    }
  });

  it('counts the rows with a link and the rest by reason, and says when «Riprova» can help', () => {
    const summary = summarizeLinks([
      { linked: true, href: HREF('1'), norm: { act_type: 'codice civile', article: '1' }, key: 'a' },
      { linked: false, reason: 'needs_confirmation' },
      { linked: false, reason: 'unanswered' },
      { linked: false, reason: 'needs_confirmation' },
    ]);
    expect(summary).toEqual({ linked: 1, notLinked: 3, byReason: { needs_confirmation: 2, unanswered: 1 }, canRetry: true });
    expect(summarizeLinks([{ linked: false, reason: 'date_incomplete' }]).canRetry).toBe(false);
  });
});

describe('the span of a link (§4.3 point 4, §4.4)', () => {
  it('from the head to the end of the act, without «l’», «dell’» or the punctuation after it', () => {
    const text = 'Visto l’art. 2043 c.c., e dell’art. 7 della legge 241/1990; poi (lett. b) art. 5, lett. b)';
    const span = (from: string, to: string) => {
      const start = text.indexOf(from);
      const got = linkSpan(text, start, text.indexOf(to, start) + to.length);
      return got ? text.slice(got.start, got.end) : null;
    };
    expect(span('l’art. 2043', 'c.c.,')).toBe('art. 2043 c.c.');
    expect(span('dell’art. 7', '1990;')).toBe('art. 7 della legge 241/1990');
    expect(span('art. 5', 'b)')).toBe('art. 5, lett. b)');
  });

  it('never across a line break', () => {
    expect(linkSpan('art. 5\nc.c.', 0, 11)).toBeNull();
  });

  it('a list links each number on its own: the marks of the rows', () => {
    const text = 'gli artt. 1223 e 1225 c.c.';
    const rows = [row({ start: 4, end: 14, article: '1223' }), row({ start: 17, end: 26, article: '1225' })];
    const links = documentLinks(text, rows, [
      { linked: true, href: HREF('1223'), norm: { act_type: 'codice civile', article: '1223' }, key: 'a' },
      { linked: true, href: HREF('1225'), norm: { act_type: 'codice civile', article: '1225' }, key: 'b' },
    ]);
    expect(links.map((l) => text.slice(l.start, l.end))).toEqual(['artt. 1223', '1225 c.c.']);
    expect(links.map((l) => l.row)).toEqual([0, 1]);
  });
});

describe('the paste (§5.2)', () => {
  const text = 'Primo: art. 2043 c.c. <e> «A & B».\n\nSecondo: art. 7 l. 241/1990.';
  const at = (words: string) => ({ start: text.indexOf(words), end: text.indexOf(words) + words.length });
  const links = [
    { ...at('art. 2043 c.c.'), href: HREF('2043') },
    { ...at('art. 7 l. 241/1990'), href: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art7!vig=2026-11-01' },
  ];

  it('HTML: one <p> a line, every character escaped, an <a> on each link, no other markup', () => {
    const paste = buildLinkedPaste(text, links);
    expect(paste.links).toBe(2);
    expect(paste.html).toBe(
      `<p>Primo: <a href="${HREF('2043')}">art. 2043 c.c.</a> &lt;e&gt; «A &amp; B».</p><p></p>`
      + '<p>Secondo: <a href="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art7!vig=2026-11-01">art. 7 l. 241/1990</a>.</p>',
    );
    expect(paste.html).not.toMatch(/style=|class=|<span|<b>|<font/);
  });

  it('plain: the address in brackets after each linked citation', () => {
    expect(buildLinkedPaste(text, links).plain).toBe(
      `Primo: art. 2043 c.c. (${HREF('2043')}) <e> «A & B».\n\nSecondo: art. 7 l. 241/1990 (${links[1].href}).`,
    );
  });

  it('leaves out a link with a bad address, one across a line, one that overlaps — the text stays whole', () => {
    const paste = buildLinkedPaste('art. 1 c.c.\nart. 2 c.c.', [
      { start: 0, end: 11, href: 'javascript:alert(1)' },
      { start: 4, end: 16, href: HREF('1') },
      { start: 12, end: 23, href: HREF('2') },
      { start: 14, end: 18, href: HREF('3') },
    ]);
    expect(paste.links).toBe(1);
    expect(paste.html).toBe(`<p>art. 1 c.c.</p><p><a href="${HREF('2')}">art. 2 c.c.</a></p>`);
    expect(paste.html).not.toContain('javascript');
  });

  it('escapes an address’s quotes, so no attribute can be closed', () => {
    const paste = buildLinkedPaste('art. 1 c.c.', [{ start: 0, end: 11, href: 'https://www.normattiva.it/x?"onmouseover="y' }]);
    expect(paste.html).toContain('href="https://www.normattiva.it/x?&quot;onmouseover=&quot;y"');
  });
});

describe('copyLinkedPaste', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalItem;
  });
  const paste = { html: '<p>x</p>', plain: 'x', links: 0 };

  it('writes HTML and plain text in one write, the items as promises', async () => {
    const write = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } });
    const items: Array<Record<string, Promise<Blob>>> = [];
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class { constructor(data: Record<string, Promise<Blob>>) { items.push(data); } };
    expect(await copyLinkedPaste(Promise.resolve(paste))).toBe('rich');
    expect(write).toHaveBeenCalledTimes(1);
    // jsdom's Blob has no text(), and Node's Response does not read it: a FileReader does.
    const read = async (blob: Promise<Blob>) => {
      const ready = await blob;
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(ready);
      });
    };
    expect(await read(items[0]['text/html'])).toBe('<p>x</p>');
    expect(await read(items[0]['text/plain'])).toBe('x');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back on the plain text when the rich write is refused or not there', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: vi.fn(async () => { throw new Error('denied'); }), writeText } });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {};
    expect(await copyLinkedPaste(paste)).toBe('plain');
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = undefined;
    expect(await copyLinkedPaste(paste)).toBe('plain');
    expect(writeText).toHaveBeenCalledWith('x');
  });

  it('throws where the clipboard cannot be written at all, for the page to say so', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = undefined;
    await expect(copyLinkedPaste(paste)).rejects.toThrow();
  });
});

describe('prepareLinks — «Prepara i link» and «Riprova»', () => {
  const rows = [row({ start: 0, end: 5, article: '2043' }), row({ start: 6, end: 9, article: '1218' }), row({ start: 10, end: 14, article: '7', state: 'inherited', act: L241 })];

  it('asks only for the eligible norms, then for what was left unanswered, then for what a confirmation adds', async () => {
    const ask = vi.fn(async (norms: LinkNorm[]) => ({
      answers: new Map(norms.filter((n) => n.article !== '1218').map((n) => [normKey(n), ok(n.article)] as const)),
      unanswered: norms.filter((n) => n.article === '1218').map(normKey),
    }));
    const first = await prepareLinks(rows, { ask });
    expect(ask.mock.calls[0][0].map((n) => n.article)).toEqual(['2043', '1218']);
    expect(first.summary).toMatchObject({ linked: 1, byReason: { unanswered: 1, needs_confirmation: 1 }, canRetry: true });

    ask.mockImplementation(async (norms: LinkNorm[]) => ({ answers: new Map(norms.map((n) => [normKey(n), ok(n.article)] as const)), unanswered: [] }));
    const retried = await prepareLinks(rows, { known: first.answers, retry: true, ask });
    expect(ask.mock.calls[1][0].map((n) => n.article)).toEqual(['1218']);
    expect(retried.summary).toMatchObject({ linked: 2, canRetry: false });

    const confirmed = await prepareLinks(rows, { known: retried.answers, choices: new Map([[2, { confirmed: true }]]), ask });
    expect(ask.mock.calls[2][0]).toEqual([{ act_type: 'legge', act_number: '241', date: '1990', article: '7' }]);
    expect(confirmed.summary.linked).toBe(3);
  });

  it('sends a norm’s reading only: no text, no place, no state', async () => {
    const ask = vi.fn<(norms: LinkNorm[]) => Promise<{ answers: Map<string, LinkAnswer>; unanswered: string[] }>>(async () => ({ answers: new Map(), unanswered: [] }));
    await prepareLinks([row({ start: 100, end: 120, article: '2043', query: 'art. 2043 c.c.' })], { ask });
    expect(ask.mock.calls[0][0]).toEqual([{ act_type: 'codice civile', article: '2043' }]);
  });
});
