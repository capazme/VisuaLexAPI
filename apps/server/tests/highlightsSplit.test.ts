import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { app, authHeader, createSharedEnv, createTestUser, prisma, request } from './helpers';
import { prisma as appPrisma } from '../src/lib/prisma';

// POST /highlights takes `splitFrom` (G-418, the owner's decision of 3 November 2026): when the web's highlighter cuts a
// piece out of the middle of a highlight (A4), the second part is created here and keeps the cut highlight's
// attribution, so a highlight taken from the Forum keeps its first author on both parts.

const KEY = 'codice-civile::art::2043';
const plain = 'Il danno ingiusto obbliga colui che ha commesso il fatto a risarcire il danno.';
const range = (words: string) => ({ text: words, startOffset: plain.indexOf(words), endOffset: plain.indexOf(words) + words.length });

describe('POST /highlights — a part of a highlight cut in the middle (G-418)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('takes the cut highlight\'s first author and suggestion when it is the same user\'s, and says the author as GET does', async () => {
    const alice = await createTestUser('g418-taker');
    const bob = await createTestUser('g418-author');
    const env = await createSharedEnv(bob);
    const suggestion = await prisma.environmentSuggestion.create({ data: { sharedEnvironmentId: env.id, suggesterId: bob.id } });
    const cut = await prisma.highlight.create({
      data: { userId: alice.id, normaKey: KEY, color: 'green', ...range('danno ingiusto obbliga colui'), originalAuthorId: bob.id, sourceSuggestionId: suggestion.id },
    });

    const res = await request(app)
      .post('/api/highlights')
      .set(authHeader(alice))
      .send({ normaKey: KEY, color: 'green', ...range('obbliga colui'), splitFrom: cut.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: alice.id, text: 'obbliga colui', originalAuthorId: bob.id, sourceSuggestionId: suggestion.id,
      originalAuthor: { id: bob.id, username: 'g418-author' },
    });
    expect(res.body.id).not.toBe(cut.id);
    // The cut highlight is left as it was: the web shrinks it with PUT.
    expect(await prisma.highlight.findUniqueOrThrow({ where: { id: cut.id } })).toMatchObject({ text: 'danno ingiusto obbliga colui' });
  });

  it('a part of the user\'s own highlight with no author has none either', async () => {
    const alice = await createTestUser('g418-own');
    const cut = await prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, ...range('danno ingiusto obbliga colui') } });

    const res = await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, ...range('colui'), splitFrom: cut.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ originalAuthorId: null, sourceSuggestionId: null, originalAuthor: null });
  });

  it('refuses another user\'s highlight as the one cut with the answer an unknown id gets, and creates nothing', async () => {
    const alice = await createTestUser('g418-alice');
    const mallory = await createTestUser('g418-mallory');
    const bob = await createTestUser('g418-bob');
    const theirs = await prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, ...range('il fatto'), originalAuthorId: bob.id } });

    const res = await request(app).post('/api/highlights').set(authHeader(mallory)).send({ normaKey: KEY, ...range('fatto'), splitFrom: theirs.id });
    const unknown = await request(app).post('/api/highlights').set(authHeader(mallory))
      .send({ normaKey: KEY, ...range('fatto'), splitFrom: '7a9c1b52-4f3e-4d6a-9b1e-2c8d5f0a1e33' });

    expect(res.status).toBe(404);
    // Nothing tells another user's id from one that names no highlight.
    expect(res.body).toEqual(unknown.body);
    expect(await prisma.highlight.count({ where: { userId: mallory.id } })).toBe(0);
  });

  it('refuses an assistant\'s mark as the one cut, the user\'s own included (D7b)', async () => {
    const alice = await createTestUser('g418-assistant');
    const text = 'danno ingiusto';
    const mark = await prisma.highlight.create({
      data: {
        userId: alice.id, normaKey: KEY, color: 'yellow', ...range(text), createdByClientId: 'client-1', createdByClientName: 'Claude Code',
        dossierItemId: '5b1f0c3e-2d4a-4e8b-9c7f-1a2b3c4d5e6f', assistantText: text, assistantStartOffset: range(text).startOffset,
      },
    });

    const res = await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, ...range('ingiusto'), splitFrom: mark.id });

    expect(res.status).toBe(404);
    expect(await prisma.highlight.count({ where: { userId: alice.id, createdByClientId: null } })).toBe(0);
  });

  it('never takes an attribution from the body, with or without a part', async () => {
    const alice = await createTestUser('g418-body');
    const bob = await createTestUser('g418-body-author');
    const cut = await prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, ...range('danno ingiusto obbliga colui') } });

    const part = await request(app).post('/api/highlights').set(authHeader(alice))
      .send({ normaKey: KEY, ...range('colui'), splitFrom: cut.id, originalAuthorId: bob.id, sourceSuggestionId: cut.id });
    const plainOne = await request(app).post('/api/highlights').set(authHeader(alice))
      .send({ normaKey: KEY, ...range('il fatto'), originalAuthorId: bob.id });

    expect(part.status).toBe(201);
    expect(part.body).toMatchObject({ originalAuthorId: null, sourceSuggestionId: null });
    expect(plainOne.status).toBe(201);
    expect(plainOne.body).toMatchObject({ originalAuthorId: null });
  });

  it('takes the attribution as it is now when what it named went meanwhile, and makes the part', async () => {
    const alice = await createTestUser('g418-race');
    const bob = await createTestUser('g418-race-author');
    const cut = await prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, ...range('danno ingiusto obbliga colui'), originalAuthorId: bob.id } });
    // The author's account goes between the read and the create: the database refuses the reference once (the app's
    // own client, not the tests').
    vi.spyOn(appPrisma.highlight, 'create').mockImplementationOnce(async () => {
      await prisma.highlight.update({ where: { id: cut.id }, data: { originalAuthorId: null } });
      throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', { code: 'P2003', clientVersion: Prisma.prismaVersion.client });
    });

    const res = await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, ...range('colui'), splitFrom: cut.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ text: 'colui', originalAuthorId: null });
  });

  it('refuses an id that names no highlight (404) and one that is no id (400), and creates nothing', async () => {
    const alice = await createTestUser('g418-unknown');

    const unknown = await request(app).post('/api/highlights').set(authHeader(alice))
      .send({ normaKey: KEY, ...range('danno'), splitFrom: '7a9c1b52-4f3e-4d6a-9b1e-2c8d5f0a1e33' });
    const malformed = await request(app).post('/api/highlights').set(authHeader(alice))
      .send({ normaKey: KEY, ...range('danno'), splitFrom: 'non-un-id' });

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
    expect(await prisma.highlight.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('refuses a part on another text than the highlight cut', async () => {
    const alice = await createTestUser('g418-text');
    const cut = await prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, ...range('il danno.') } });

    const res = await request(app).post('/api/highlights').set(authHeader(alice))
      .send({ normaKey: 'codice-civile::art::2044', ...range('danno'), splitFrom: cut.id });

    expect(res.status).toBe(400);
    expect(await prisma.highlight.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('a highlight made without it, or with it null, is as before: no attribution, and the answer carries no author', async () => {
    const alice = await createTestUser('g418-plain');

    const res = await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, ...range('danno ingiusto') });
    const nulled = await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, ...range('il fatto'), splitFrom: null });

    for (const answer of [res, nulled]) {
      expect(answer.status).toBe(201);
      expect(answer.body).toMatchObject({ userId: alice.id, color: 'yellow', originalAuthorId: null, sourceSuggestionId: null });
      expect(answer.body).not.toHaveProperty('originalAuthor');
    }
  });
});
