import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, type TestUser } from './helpers';

describe('publish shared environment — content round-trip', () => {
  let alice: TestUser;

  beforeEach(async () => {
    alice = await createTestUser('alice');
  });

  it('persists customAliases through a publish round-trip', async () => {
    const customAliases = [
      { trigger: 'cc', aliasType: 'shortcut', expandTo: 'codice civile' },
      { trigger: 'tue', aliasType: 'reference', expandTo: 'Trattato sull\'Unione Europea' },
    ];

    const publishRes = await request(app)
      .post('/api/shared-environments')
      .set(authHeader(alice))
      .send({
        title: 'Ambiente con alias',
        category: 'civil',
        content: {
          dossiers: [],
          quickNorms: [],
          customAliases,
          annotations: [],
          highlights: [],
        },
      });

    expect(publishRes.status).toBe(201);
    expect(publishRes.body.content.customAliases).toEqual(customAliases);

    // Re-read via the download endpoint to confirm persistence (a non-owner
    // download returns the stored content verbatim).
    const bob = await createTestUser('bob');
    const downloadRes = await request(app)
      .post(`/api/shared-environments/${publishRes.body.id}/download`)
      .set(authHeader(bob));

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.content.customAliases).toEqual(customAliases);
  });

  it('publishes without customAliases (field optional)', async () => {
    const publishRes = await request(app)
      .post('/api/shared-environments')
      .set(authHeader(alice))
      .send({
        title: 'Ambiente senza alias',
        category: 'civil',
        content: {
          dossiers: [],
          quickNorms: [],
          annotations: [],
          highlights: [],
        },
      });

    expect(publishRes.status).toBe(201);
    expect(publishRes.body.content.customAliases).toBeUndefined();
  });
});
