import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request, type TestUser } from './helpers';

/**
 * G-595, the owner's words: «Sì: il server riceve tutte le voci in una richiesta, applica i limiti della G-576 in
 * una volta e risponde con quante sono entrate». `POST /api/dossiers/:id/items/bulk` takes a dossier's entries in
 * one request and one transaction: each entry is checked as a single add checks it, the caps (500 dossiers, 2,000
 * entries per dossier, 10,000 per account) once for the batch, and the answer says how many entered and, for each
 * one that did not, why, in the single route's own words.
 */

const bulk = (user: TestUser, dossierId: string, items: unknown[]) =>
  request(app).post(`/api/dossiers/${dossierId}/items/bulk`).set(authHeader(user)).send({ items });

async function dossierWith(user: TestUser, items: number, name = 'Pratica'): Promise<string> {
  const dossier = await prisma.dossier.create({ data: { name, userId: user.id } });
  if (items > 0) {
    await prisma.dossierItem.createMany({
      data: Array.from({ length: items }, (_, i) => ({ dossierId: dossier.id, itemType: 'note' as const, title: 'Nota', content: 'x', position: i })),
    });
  }
  return dossier.id;
}

const note = (i: number) => ({ itemType: 'note', title: `Nota ${i}`, content: `testo ${i}` });
const norm = (article: string) => ({
  itemType: 'norm', title: 'codice civile', content: { tipo_atto: 'codice civile', numero_articolo: article, data: '1942-03-16', numero_atto: '262' },
});

describe('the entries of a dossier in one request', () => {
  it('adds them in order after the entries already there, and says how many entered', async () => {
    const user = await createTestUser('bulk-order');
    const id = await dossierWith(user, 2);
    const res = await bulk(user, id, [norm('2043'), note(1), norm('2044')]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ entered: 3, total: 3, refused: [] });
    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(['codice civile', 'Nota 1', 'codice civile']);
    const stored = await prisma.dossierItem.findMany({ where: { dossierId: id }, orderBy: { position: 'asc' } });
    expect(stored.map((i) => i.position)).toEqual([0, 1, 2, 3, 4]);
    expect(stored.slice(2).map((i) => i.title)).toEqual(['codice civile', 'Nota 1', 'codice civile']);
  });

  it('refuses a bad entry in the single route\'s words, and lets the others in', async () => {
    const user = await createTestUser('bulk-invalid');
    const id = await dossierWith(user, 0);
    const longTitle = { itemType: 'note', title: 'x'.repeat(1001), content: 'x' };
    const single = await request(app).post(`/api/dossiers/${id}/items`).set(authHeader(user)).send(longTitle);
    expect(single.status).toBe(400);
    const badDecision = { itemType: 'sentenza', title: 'Cass.', content: { autorita: 'nessuna' } };
    const singleDecision = await request(app).post(`/api/dossiers/${id}/items`).set(authHeader(user)).send(badDecision);
    expect(singleDecision.status).toBe(400);
    const unknownType = { itemType: 'quadro', title: 'x' };
    const singleType = await request(app).post(`/api/dossiers/${id}/items`).set(authHeader(user)).send(unknownType);
    expect(singleType.status).toBe(400);

    const res = await bulk(user, id, [note(1), longTitle, badDecision, unknownType, note(2)]);
    expect(res.status).toBe(201);
    expect(res.body.entered).toBe(2);
    expect(res.body.refused).toEqual([
      { index: 1, error: 'too_long', detail: single.body.detail },
      { index: 2, error: 'invalid', detail: singleDecision.body.detail },
      { index: 3, error: 'invalid', detail: singleType.body.detail },
    ]);
  });

  it('lets in what fits in the dossier, and refuses the rest with the cap\'s own sentence', async () => {
    const user = await createTestUser('bulk-dossier-cap');
    const id = await dossierWith(user, 1990);
    const res = await bulk(user, id, Array.from({ length: 15 }, (_, i) => note(i)));
    expect(res.status).toBe(201);
    expect(res.body.entered).toBe(10);
    expect(res.body.refused).toHaveLength(5);
    expect(res.body.refused[0]).toEqual({
      index: 10, error: 'dossier_items_limit', detail: 'Una pratica può contenere al massimo 2.000 voci. Questa ne ha già 1.990.',
    });
    expect(await prisma.dossierItem.count({ where: { dossierId: id } })).toBe(2000);
  });

  it('lets in what fits in the account, and refuses the rest with the total\'s sentence', async () => {
    const user = await createTestUser('bulk-account-cap');
    for (let d = 0; d < 4; d += 1) await dossierWith(user, 2000, `Piena ${d}`);
    await dossierWith(user, 1995, 'Quasi');
    const id = await dossierWith(user, 0, 'Nuova');
    const res = await bulk(user, id, Array.from({ length: 8 }, (_, i) => note(i)));
    expect(res.body.entered).toBe(5);
    expect(res.body.refused.map((r: { error: string }) => r.error)).toEqual(Array(3).fill('account_items_limit'));
    expect(res.body.refused[0].detail).toContain('10.000 voci in tutto');
  });

  it('answers 200 with nothing entered when nothing fits', async () => {
    const user = await createTestUser('bulk-full');
    const id = await dossierWith(user, 2000);
    const res = await bulk(user, id, [note(1)]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ entered: 0, total: 1, items: [] });
    expect(res.body.refused[0].error).toBe('dossier_items_limit');
  });

  it('refuses a dossier that is not the user\'s, and writes nothing', async () => {
    const user = await createTestUser('bulk-owner');
    const other = await createTestUser('bulk-other');
    const theirs = await dossierWith(other, 0);
    const res = await bulk(user, theirs, [note(1)]);
    expect(res.status).toBe(404);
    expect(await prisma.dossierItem.count({ where: { dossierId: theirs } })).toBe(0);
  });

  it('takes at most 2,000 entries in one request', async () => {
    const user = await createTestUser('bulk-too-many');
    const id = await dossierWith(user, 0);
    const res = await bulk(user, id, Array.from({ length: 2001 }, (_, i) => note(i)));
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('Al massimo 2.000 voci per richiesta.');
    expect(await prisma.dossierItem.count({ where: { dossierId: id } })).toBe(0);
  });

  it('takes 2,000 entries carrying their article text, well over the usual 2 MB body', async () => {
    const user = await createTestUser('bulk-big');
    const id = await dossierWith(user, 0);
    const text = 'Art. 2043. Risarcimento per fatto illecito. '.repeat(57);
    const items = Array.from({ length: 2000 }, (_, i) => ({ ...norm(String(1 + i)), content: { ...norm(String(1 + i)).content, article_text: text } }));
    expect(Buffer.byteLength(JSON.stringify({ items }))).toBeGreaterThan(4 * 1024 * 1024);
    const res = await bulk(user, id, items);
    expect(res.status).toBe(201);
    expect(res.body.entered).toBe(2000);
  });

  it('counts on the write limiter by its size: 1, plus 1 for each 50 entries past the first 50', async () => {
    const user = await createTestUser('bulk-limiter');
    const id = await dossierWith(user, 0);
    const res = await bulk(user, id, Array.from({ length: 120 }, (_, i) => note(i)));
    expect(res.status).toBe(201);
    // 200 writes a minute: this request costs 1 + 2 (entries 51-100, 101-120).
    expect(Number(res.headers['ratelimit-remaining'])).toBe(197);
  });
});
