import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request } from './helpers';

// PUT /highlights/:id takes a highlight's range too (G-417, the owner's decision of 3 November 2026): the web's
// highlighter shrinks a highlight in place when it cuts a piece out (A4), so the row stays the same — its id, its owner
// and its first author.

const KEY = 'codice-civile::art::2043';
const plain = 'Il danno ingiusto obbliga colui che ha commesso il fatto a risarcire il danno.';
const at = (words: string) => plain.indexOf(words);

async function highlight(userId: string, words: string, extra: { originalAuthorId?: string } = {}) {
  return prisma.highlight.create({
    data: { userId, normaKey: KEY, text: words, color: 'yellow', startOffset: at(words), endOffset: at(words) + words.length, ...extra },
  });
}

describe('PUT /highlights/:id — the range (G-417)', () => {
  it('moves a highlight\'s words in place: the same row, its colour and note kept', async () => {
    const alice = await createTestUser('g417-alice');
    const row = await highlight(alice.id, 'il danno ingiusto obbliga');
    await prisma.highlight.update({ where: { id: row.id }, data: { color: 'green', note: 'resta' } });

    const res = await request(app)
      .put(`/api/highlights/${row.id}`)
      .set(authHeader(alice))
      .send({ startOffset: at('ingiusto'), endOffset: at('ingiusto') + 'ingiusto'.length, text: 'ingiusto' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: row.id, text: 'ingiusto', startOffset: at('ingiusto'), endOffset: at('ingiusto') + 8, color: 'green', note: 'resta' });
    const stored = await prisma.highlight.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ text: 'ingiusto', startOffset: at('ingiusto'), endOffset: at('ingiusto') + 8, userId: alice.id, color: 'green' });
    expect(await prisma.highlight.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('keeps the first author of a highlight taken from the Forum, and says it as GET does', async () => {
    const alice = await createTestUser('g417-taker');
    const bob = await createTestUser('g417-author');
    const row = await highlight(alice.id, 'Il danno ingiusto', { originalAuthorId: bob.id });

    const res = await request(app)
      .put(`/api/highlights/${row.id}`)
      .set(authHeader(alice))
      .send({ startOffset: 0, endOffset: 8, text: 'Il danno', color: 'red' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ originalAuthorId: bob.id, originalAuthor: { id: bob.id, username: 'g417-author' }, color: 'red' });
    const stored = await prisma.highlight.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ originalAuthorId: bob.id, userId: alice.id, text: 'Il danno', startOffset: 0, endOffset: 8 });
  });

  it('refuses another user\'s highlight, and changes nothing', async () => {
    const alice = await createTestUser('g417-owner');
    const mallory = await createTestUser('g417-other');
    const row = await highlight(alice.id, 'risarcire il danno');

    const res = await request(app)
      .put(`/api/highlights/${row.id}`)
      .set(authHeader(mallory))
      .send({ startOffset: 0, endOffset: 2, text: 'Il' });

    expect(res.status).toBe(404);
    expect(await prisma.highlight.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ text: 'risarcire il danno', startOffset: at('risarcire') });
  });

  it.each([
    ['an end before its start', { startOffset: 10, endOffset: 5, text: 'danno' }],
    ['an empty range', { startOffset: 10, endOffset: 10, text: 'x' }],
    ['a length that is not the text\'s', { startOffset: 3, endOffset: 20, text: 'danno' }],
    ['a negative start', { startOffset: -1, endOffset: 4, text: 'Il d' }],
    ['an empty text', { startOffset: 3, endOffset: 3, text: '' }],
    ['a start alone', { startOffset: 3 }],
    ['words with no range', { text: 'danno' }],
    ['a range with no words', { startOffset: 3, endOffset: 8 }],
    ['an offset that is not a whole number', { startOffset: 3.5, endOffset: 8.5, text: 'danno' }],
  ])('refuses %s, and changes nothing', async (_name, body) => {
    const alice = await createTestUser(`g417-range-${Math.random().toString(36).slice(2, 8)}`);
    const row = await highlight(alice.id, 'danno ingiusto');

    const res = await request(app).put(`/api/highlights/${row.id}`).set(authHeader(alice)).send(body);

    expect(res.status).toBe(400);
    expect(await prisma.highlight.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      text: 'danno ingiusto', startOffset: at('danno ingiusto'), endOffset: at('danno ingiusto') + 14,
    });
  });

  it('a colour alone still changes the colour alone, the words where they were', async () => {
    const alice = await createTestUser('g417-colour');
    const row = await highlight(alice.id, 'danno ingiusto');

    const res = await request(app).put(`/api/highlights/${row.id}`).set(authHeader(alice)).send({ color: 'blue' });

    expect(res.status).toBe(200);
    expect(await prisma.highlight.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      color: 'blue', text: 'danno ingiusto', startOffset: at('danno ingiusto'), endOffset: at('danno ingiusto') + 14,
    });
  });
});
