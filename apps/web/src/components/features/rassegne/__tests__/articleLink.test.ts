import { describe, expect, it } from 'vitest';
import { articleLink } from '../articleLink';

const N = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:';

describe('articleLink', () => {
  it('writes the article by the source convention and opens it as a search', () => {
    expect(articleLink({ urn: `${N}regio.decreto:1942-03-16;262:2~art2043`, citazione: 'art. 2043 cod. civ.' })).toEqual({
      label: 'art. 2043 c.c.',
      params: { act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '2043', version: 'vigente', version_date: '' },
    });
    const bis = articleLink({ urn: `${N}legge:1990-08-07;241~art21octies`, citazione: 'art. 21-octies' });
    expect(bis.label).toBe('art. 21-octies l. 241/1990');
    expect(bis.params).toMatchObject({ act_type: 'legge', act_number: '241', date: '1990-08-07', article: '21-octies' });
    expect(articleLink({ urn: `${N}costituzione~art111`, citazione: 'art. 111 Cost.' }).params).toMatchObject({ act_type: 'costituzione', article: '111' });
  });

  it('keeps the passage\'s words, and no link, when the URN names no article', () => {
    expect(articleLink({ urn: `${N}regio.decreto:1942-03-16;262`, citazione: 'r.d. n. 262 del 1942' })).toEqual({ label: 'r.d. n. 262 del 1942', params: null });
  });
});
