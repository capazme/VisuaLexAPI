import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';

/**
 * Fields that had no length limit (item 14 of the security inventory). One character over the limit is refused with
 * a 400 in Italian that names the field, and nothing is written; at the limit, the write goes through.
 */
const over = (n: number) => 'a'.repeat(n + 1);
const at = (n: number) => 'a'.repeat(n);
const tooLong = (field: string, max: string) => ({ detail: `Campo «${field}»: al massimo ${max} caratteri.`, error: 'too_long' });

async function dossierOf(user: TestUser) {
  const created = await request(app).post('/api/dossiers').set(authHeader(user)).send({ name: 'Limiti' });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

describe('a field over its limit', () => {
  it('a note on an article: refused at 50.001 characters, saved at 50.000', async () => {
    const user = await createTestUser('limits-annotation');
    const refused = await request(app).post('/api/annotations').set(authHeader(user))
      .send({ normaKey: 'codice-civile--art-1453', content: over(50_000) });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual(tooLong('nota', '50.000'));
    expect(await prisma.annotation.count({ where: { userId: user.id } })).toBe(0);

    const saved = await request(app).post('/api/annotations').set(authHeader(user))
      .send({ normaKey: 'codice-civile--art-1453', content: at(50_000) });
    expect(saved.status).toBe(201);
  });

  it('a bookmark: refused with 51 tags, or a tag of 101 characters', async () => {
    const user = await createTestUser('limits-bookmark');
    const tooMany = await request(app).post('/api/bookmarks').set(authHeader(user))
      .send({ normaKey: 'codice-civile--art-1', tags: Array.from({ length: 51 }, (_, i) => `t${i}`) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toEqual({ detail: 'Campo «tag»: al massimo 50 voci.', error: 'too_long' });
    const longTag = await request(app).post('/api/bookmarks').set(authHeader(user))
      .send({ normaKey: 'codice-civile--art-1', tags: [over(100)] });
    expect(longTag.body).toEqual(tooLong('tag', '100'));
    expect(await prisma.bookmark.count({ where: { userId: user.id } })).toBe(0);
  });

  it('a highlight’s note, an alias, a history entry, a dossier and its item: each names its field', async () => {
    const user = await createTestUser('limits-various');
    const highlight = await request(app).post('/api/highlights').set(authHeader(user))
      .send({ normaKey: 'codice-civile--art-2', text: 'testo', startOffset: 0, endOffset: 5, note: over(50_000) });
    expect(highlight.body).toEqual(tooLong('nota', '50.000'));

    const alias = await request(app).post('/api/custom-aliases').set(authHeader(user))
      .send({ trigger: 'cc', type: 'shortcut', expandTo: over(1_000) });
    expect(alias.body).toEqual(tooLong('testo esteso', '1.000'));

    const history = await request(app).post('/api/history').set(authHeader(user)).send({ act_type: over(200) });
    expect(history.status).toBe(400);
    expect(history.body).toEqual(tooLong('tipo di atto', '200'));

    const dossier = await request(app).post('/api/dossiers').set(authHeader(user)).send({ name: 'D', description: over(5_000) });
    expect(dossier.body).toEqual(tooLong('descrizione', '5.000'));

    const dossierId = await dossierOf(user);
    const item = await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(user))
      .send({ itemType: 'note', title: over(1_000) });
    expect(item.body).toEqual(tooLong('titolo', '1.000'));
    expect(await prisma.dossierItem.count({ where: { dossierId } })).toBe(0);
  });

  it('a password or a username at the door: refused for its length before any check', async () => {
    const user = await createTestUser('limits-login');
    const login = await request(app).post('/api/auth/login').set({ 'X-Forwarded-For': '203.0.122.1' })
      .send({ email: user.email, password: over(1_024) });
    expect(login.status).toBe(400);
    expect(login.body).toEqual(tooLong('password', '1.024'));

    const register = await request(app).post('/api/auth/register').set({ 'X-Forwarded-For': '203.0.122.2' })
      .send({ email: 'limits-new@test.local', username: over(50), password: 'Abcdefg1' });
    expect(register.body).toEqual(tooLong('nome utente', '50'));
  });

  it('takes what the web sends today: a long selection as a note’s context, «Apri tutto» with 150 articles', async () => {
    const user = await createTestUser('limits-real-use');
    const note = await request(app).post('/api/annotations').set(authHeader(user))
      .send({ normaKey: 'codice-civile--art-1', content: 'Nota.', textContext: at(60_000) });
    expect(note.status).toBe(201);
    const articles = Array.from({ length: 150 }, (_, i) => `${2043 + i}-quinquiesdecies`).join(',');
    const history = await request(app).post('/api/history').set(authHeader(user))
      .send({ act_type: 'codice civile', article: articles });
    expect(history.status).toBe(201);
  });

  it('refuses an email over 254 characters at the door', async () => {
    const register = await request(app).post('/api/auth/register').set({ 'X-Forwarded-For': '203.0.122.3' })
      .send({ email: `${over(250)}@x.it`, username: 'limits-email', password: 'Abcdefg1' });
    expect(register.body).toEqual(tooLong('email', '254'));
  });

  it('leaves every other validation answer as it was', async () => {
    const user = await createTestUser('limits-other');
    const missing = await request(app).post('/api/annotations').set(authHeader(user)).send({ normaKey: 'x' });
    expect(missing.status).toBe(400);
    expect(missing.body.detail).toMatch(/^Invalid request: content/);
    expect(missing.body.error).toBeUndefined();
  });
});
