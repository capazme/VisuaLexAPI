import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';
import { delegatedToken } from './oauth/oauthHelpers';

// Which connected application created a dossier or an entry (MCP second round,
// spec §5): set by the server from the delegation, never from a body.
describe('dossier provenance', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('provenance-alice');
  });

  it('a dossier created through an exchanged token records the connection', async () => {
    const { apiToken } = await delegatedToken(alice);
    const created = await request(app)
      .post('/api/dossiers')
      .set({ Authorization: `Bearer ${apiToken}` })
      .send({ name: 'Da Claude' });
    expect(created.status).toBe(201);
    expect(created.body.created_by).toEqual({ clientName: 'Claude Code' });
    const read = await request(app).get(`/api/dossiers/${created.body.id}`).set(authHeader(alice));
    expect(read.body.created_by).toEqual({ clientName: 'Claude Code' });
    const list = await request(app).get('/api/dossiers').set(authHeader(alice));
    expect(list.body[0].created_by).toEqual({ clientName: 'Claude Code' });
  });

  it('a dossier and an entry the user creates are unmarked, whatever the body says', async () => {
    const dossier = await request(app)
      .post('/api/dossiers')
      .set(authHeader(alice))
      .send({ name: 'Mio', createdByClientName: 'Claude', createdByClientId: 'x' });
    expect(dossier.body.created_by).toBeNull();
    const item = await request(app)
      .post(`/api/dossiers/${dossier.body.id}/items`)
      .set(authHeader(alice))
      .send({ itemType: 'note', title: 'Nota', content: 'mia', createdByClientName: 'Claude' });
    expect(item.status).toBe(201);
    expect(item.body.created_by).toBeNull();
    const read = await request(app).get(`/api/dossiers/${dossier.body.id}`).set(authHeader(alice));
    expect(read.body.created_by).toBeNull();
    expect(read.body.items[0].created_by).toBeNull();
  });

  it('every entry carries about_item_id, null unless a note is about an article', async () => {
    const dossier = await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Prova' });
    await request(app)
      .post(`/api/dossiers/${dossier.body.id}/items`)
      .set(authHeader(alice))
      .send({ itemType: 'note', title: 'Nota', content: 'mia' });
    const read = await request(app).get(`/api/dossiers/${dossier.body.id}`).set(authHeader(alice));
    expect(read.body.items[0]).toHaveProperty('about_item_id', null);
    const list = await request(app).get('/api/dossiers').set(authHeader(alice));
    expect(list.body[0].items[0]).toHaveProperty('about_item_id', null);
  });
});
