import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatNormCitation } from './citation';
import { copyNormLink, linkPinDay, normLink, normLinkActionLabel, normLinkHtml, normLinkToast } from './normattivaLink';
import { todayInRome } from './dateUtils';
import type { ArticleValidity } from '../types';

const CC = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';
const civil = { tipo_atto: 'codice civile', numero_articolo: '2043', allegato: '2', urn: CC };
const privacy = {
  tipo_atto: 'decreto legislativo', numero_atto: '196', data: '2003-06-30', numero_articolo: '13',
  urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2003-06-30;196~art13',
};

describe('normLink', () => {
  it('takes the address the API returned and the plain citation for the text in force', () => {
    expect(normLink(civil, null)).toEqual({ href: CC, label: 'art. 2043 c.c.', european: false });
    expect(normLink(privacy, null)?.label).toBe('art. 13, d.lgs. 30 giugno 2003, n. 196');
  });

  it('keeps a past version’s marker and reads as that version', () => {
    const past = { ...civil, versione: 'vigente', data_versione: '2010-01-01', urn: `${CC}!vig=2010-01-01` };
    const citation = formatNormCitation({
      norma: past,
      validity: { state: 'historical', valid_from: '2005-01-01', valid_to: '2012-12-31', version_number: 3, act_updated: null, request_in_window: true },
      requestedDate: '2010-01-01',
    });
    const link = normLink(past, citation);
    expect(link?.href).toBe(`${CC}!vig=2010-01-01`);
    expect(link?.label).toBe('art. 2043 c.c., nel testo in vigore al 1° gennaio 2010');
    expect(normLink({ ...civil, urn: `${CC}@originale` }, null)?.href).toBe(`${CC}@originale`);
  });

  it('gives an act of the Union the act’s EUR-Lex address', () => {
    const gdpr = { tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016', numero_articolo: '5', urn: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita' };
    const link = normLink(gdpr, null);
    expect(link?.european).toBe(true);
    expect(link?.href).toBe('https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita');
    expect(normLinkActionLabel(gdpr)).toBe('Copia link EUR-Lex');
    expect(normLinkToast(link!)).toContain('EUR-Lex non ha un indirizzo per articolo');
    expect(normLinkActionLabel(civil)).toBe('Copia link Normattiva');
  });

  it('fixes an undated address to the text on screen when Normattiva would open another (G-355)', () => {
    const today = '2026-10-21';
    const current: ArticleValidity = { state: 'current', valid_from: '2005-01-01', valid_to: null, version_number: 3, act_updated: null, request_in_window: null };
    const pin = linkPinDay(civil, current, today);
    expect(pin).toBe(today);
    expect(normLink({ ...civil, urn: `${CC}!vig=` }, null, pin)?.href).toBe(`${CC}!vig=${today}`);
    expect(normLink(civil, null, pin)?.href).toBe(`${CC}!vig=${today}`);
    // Past the day of the change, the citation names the closed window (`citeAs`): so does the link.
    const closed: ArticleValidity = { state: 'historical', valid_from: '2005-01-01', valid_to: '2026-12-31', version_number: 3, act_updated: null, request_in_window: null };
    expect(linkPinDay(civil, closed, '2027-01-05')).toBe('2026-12-31');
    expect(linkPinDay(civil, { ...closed, valid_to: null }, today)).toBe('2005-01-01');
    // Nothing announced: the text in force is still fixed to today (G-395).
    expect(linkPinDay(civil, current, today)).toBe(today);
    expect(linkPinDay(civil, undefined, today)).toBe(today);
    // Without a pin day an address stays as the API gave it.
    expect(normLink({ ...civil, urn: `${CC}!vig=` }, null, undefined)?.href).toBe(`${CC}!vig=`);
  });

  it('carries today’s day in the link to the text in force, and says so in the toast (G-395)', () => {
    const current: ArticleValidity = { state: 'current', valid_from: '2005-01-01', valid_to: null, version_number: 3, act_updated: null, request_in_window: null };
    const link = normLink({ ...civil, urn: `${CC}!vig=` }, null, linkPinDay(civil, current, '2026-10-31'));
    expect(link?.href).toBe(`${CC}!vig=2026-10-31`);
    expect(normLinkToast(link!)).toBe('Link Normattiva copiato (apre il testo in vigore al 31 ottobre 2026)');
    // No pin, no date in the toast.
    expect(normLinkToast(normLink(civil, null)!)).toBe('Link Normattiva copiato');
  });

  it('takes the day in Rome around midnight, not the UTC one', () => {
    const at = (iso: string) => todayInRome(new Date(iso));
    // 22:30 UTC on 31 Oct is already 1 Nov in Rome (CET after the clocks go back on 25 Oct: UTC+1 → 23:30 on the 31st).
    expect(at('2026-10-31T22:30:00Z')).toBe('2026-10-31');
    expect(at('2026-10-31T23:30:00Z')).toBe('2026-11-01');
    expect(at('2026-10-24T22:30:00Z')).toBe('2026-10-25'); // CEST, UTC+2
    const day = at('2026-10-31T23:30:00Z');
    expect(normLink({ ...civil, urn: `${CC}!vig=` }, null, linkPinDay(civil, undefined, day))?.href).toBe(`${CC}!vig=2026-11-01`);
  });

  it('never moves an address that names its text, nor an act of the Union', () => {
    expect(linkPinDay({ ...civil, versione: 'vigente', data_versione: '2010-01-01' }, undefined, '2026-10-21')).toBeUndefined();
    expect(linkPinDay({ ...civil, versione: 'originale' }, undefined, '2026-10-21')).toBeUndefined();
    expect(linkPinDay({ tipo_atto: 'regolamento ue' }, undefined, '2026-10-21')).toBeUndefined();
    expect(normLink({ ...civil, urn: `${CC}!vig=2010-01-01` }, null, '2026-10-21')?.href).toBe(`${CC}!vig=2010-01-01`);
    expect(normLink({ ...civil, urn: `${CC}@originale` }, null, '2026-10-21')?.href).toBe(`${CC}@originale`);
    expect(normLink(civil, null, 'not a day')?.href).toBe(CC);
  });

  it('holds no link without an address of the source', () => {
    expect(normLink({ ...civil, urn: undefined }, null)).toBeNull();
    expect(normLink({ ...civil, urn: '  ' }, null)).toBeNull();
    expect(normLink({ ...civil, urn: 'javascript:alert(1)' }, null)).toBeNull();
    expect(normLink({ ...civil, urn: 'http://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge' }, null)).toBeNull();
    expect(normLink({ ...civil, urn: 'https://normattiva.it.example.org/x' }, null)).toBeNull();
  });

  it('escapes the link it writes as HTML', () => {
    expect(normLinkHtml({ href: `${CC}&x="y"`, label: 'art. 1 <b>', european: false }))
      .toBe(`<a href="${CC}&amp;x=&quot;y&quot;">art. 1 &lt;b&gt;</a>`);
  });
});

describe('copyNormLink', () => {
  const original = { clipboard: navigator.clipboard, item: globalThis.ClipboardItem };
  let write: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;

  // jsdom's Blob has no `text()`.
  const read = (blob: Blob) => new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

  class FakeClipboardItem {
    items: Record<string, Blob>;
    constructor(items: Record<string, Blob>) { this.items = items; }
  }

  beforeEach(() => {
    write = vi.fn().mockResolvedValue(undefined);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: original.clipboard, configurable: true });
    vi.unstubAllGlobals();
    if (original.item) globalThis.ClipboardItem = original.item;
  });

  it('writes the address as text and the citation as a link in one go', async () => {
    await expect(copyNormLink(normLink(civil, null)!)).resolves.toBe('rich');
    expect(writeText).not.toHaveBeenCalled();
    const [[items]] = write.mock.calls as [[FakeClipboardItem[]]];
    expect(items).toHaveLength(1);
    const { items: formats } = items[0];
    expect(Object.keys(formats).sort()).toEqual(['text/html', 'text/plain']);
    expect(await read(formats['text/plain'])).toBe(CC);
    expect(await read(formats['text/html'])).toBe(`<a href="${CC}">art. 2043 c.c.</a>`);
  });

  it('falls back to the address alone with no ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    await expect(copyNormLink(normLink(civil, null)!)).resolves.toBe('plain');
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(CC);
  });

  it('falls back to the address alone when the browser refuses the two formats', async () => {
    write.mockRejectedValue(new DOMException('refused', 'NotAllowedError'));
    await expect(copyNormLink(normLink(civil, null)!)).resolves.toBe('plain');
    expect(writeText).toHaveBeenCalledWith(CC);
  });

  it('throws when the clipboard refuses the address too', async () => {
    write.mockRejectedValue(new Error('no'));
    writeText.mockRejectedValue(new Error('no'));
    await expect(copyNormLink(normLink(civil, null)!)).rejects.toThrow();
  });
});
