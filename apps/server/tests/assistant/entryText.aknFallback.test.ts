import nock from 'nock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readEntryText, TextUnavailable } from '../../src/assistant/entryText';

// Scan A.7: when Normattiva's HTML cannot be read, the Python API serves the AKN export and says so
// (`text_source: "akn"`). That string is not the text the reader draws and the anchors live in (root rule
// 23: accents transliterated, a markdown heading): a passage located in it would be stored at offsets that
// do not land. So it is «not available yet», as when the source is down: the HTML text comes back.
const API = 'http://legal-api.test';
const NORM = { tipo_atto: 'legge', numero_articolo: '3', data: '1990-08-07', numero_atto: '241' };

beforeAll(() => nock.activate());
afterAll(() => nock.restore());

async function readWith(answer: Record<string, unknown>) {
  const original = process.env.LEGAL_API_URL;
  process.env.LEGAL_API_URL = API;
  nock(API).post('/fetch_article_text').reply(200, [{ norma_data: NORM, ...answer }]);
  try {
    return await readEntryText({ itemType: 'norm', content: NORM } as Parameters<typeof readEntryText>[0]);
  } finally {
    nock.cleanAll();
    if (original === undefined) delete process.env.LEGAL_API_URL;
    else process.env.LEGAL_API_URL = original;
  }
}

describe('an AKN fallback text is never the text to anchor to', () => {
  it('refuses it as not available yet', async () => {
    await expect(readWith({ article_text: "### Art. 3\n\n1. Ogni provvedimento e' motivato.", text_source: 'akn' }))
      .rejects.toBeInstanceOf(TextUnavailable);
  });

  it('reads the HTML text, and an answer from before the field, as before', async () => {
    for (const extra of [{ text_source: 'html' }, {}]) {
      const text = await readWith({ article_text: 'Ogni provvedimento è motivato.', ...extra });
      expect(text.display).toBe('Ogni provvedimento è motivato.');
    }
  });
});
