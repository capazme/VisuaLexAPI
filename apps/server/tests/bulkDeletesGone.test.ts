import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request } from './helpers';

// «Sostituisci» went with environments, and with it the one request that wiped all of a user's notes and highlights
// for good (spec docs/superpowers/specs/2026-10-13-environments-into-forum-design.md, D10; the owner's answer 185).

describe('no bulk delete of notes or highlights', () => {
  it('answers 404 to DELETE /annotations and DELETE /highlights, and deletes nothing', async () => {
    const alice = await createTestUser('bulk-alice');
    await prisma.annotation.create({ data: { userId: alice.id, normaKey: 'k::art::1', content: 'Nota' } });
    await prisma.highlight.create({ data: { userId: alice.id, normaKey: 'k::art::1', text: 'testo', startOffset: 0, endOffset: 5 } });

    expect((await request(app).delete('/api/annotations').set(authHeader(alice))).status).toBe(404);
    expect((await request(app).delete('/api/highlights').set(authHeader(alice))).status).toBe(404);
    expect(await prisma.annotation.count({ where: { userId: alice.id } })).toBe(1);
    expect(await prisma.highlight.count({ where: { userId: alice.id } })).toBe(1);
  });
});
