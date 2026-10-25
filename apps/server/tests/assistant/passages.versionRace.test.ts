import nock from 'nock';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { request, app, prisma, createTestUser, authHeader } from '../helpers';
import { delegatedToken } from '../oauth/oauthHelpers';

// D7b: the entry changes (another version of the article) while its text is read. The offsets would point into
// the old text, so nothing is stored: a 409. The read is wrapped to change the entry at that moment exactly.
let onRead: (() => Promise<void>) | null = null;
vi.mock('../../src/assistant/entryText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/assistant/entryText')>();
  return {
    ...actual,
    readEntryText: async (...args: Parameters<typeof actual.readEntryText>) => {
      const text = await actual.readEntryText(...args);
      await onRead?.();
      return text;
    },
  };
});

const API = 'http://legal-api.test';
const NORM = { tipo_atto: 'codice civile', numero_articolo: '1453', data: '1942-03-16', numero_atto: '262' };

beforeAll(() => nock.activate());
afterAll(() => nock.restore());

describe('a version change between the text read and the passages stored', () => {
  it('stores nothing and says why', async () => {
    const original = process.env.LEGAL_API_URL;
    process.env.LEGAL_API_URL = API;
    nock(API).post('/fetch_article_text').times(5).reply(() => [200, [{ article_text: 'Il risarcimento del danno è dovuto dal debitore.', norma_data: NORM, validity: { state: 'current' } }]]);
    try {
      const alice = await createTestUser('race-alice');
      await prisma.appSwitch.create({ data: { key: 'assistant_passages', enabled: true } });
      const dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Pratica' })).body.id;
      const itemId = (await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({ itemType: 'norm', title: 'x', content: NORM })).body.id;
      const token = (await delegatedToken(alice, 'dossier:read dossier:write dossier:text')).apiToken;
      onRead = async () => {
        await prisma.dossierItem.update({ where: { id: itemId }, data: { content: { ...NORM, data_versione: '2000-01-01' } } });
      };
      const response = await request(app)
        .post(`/api/dossiers/${dossierId}/items/${itemId}/passages`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ passaggi: [{ testo: 'Il risarcimento del danno' }] });
      expect(response.status).toBe(409);
      expect(response.body.detail).toBe('La voce è cambiata mentre ne leggevo il testo.');
      expect(await prisma.highlight.count()).toBe(0);
    } finally {
      onRead = null;
      nock.cleanAll();
      if (original === undefined) delete process.env.LEGAL_API_URL;
      else process.env.LEGAL_API_URL = original;
    }
  });
});
