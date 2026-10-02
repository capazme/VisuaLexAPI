import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createTestUser, prisma, type TestUser } from './helpers';
import { createLingoCard } from '../src/lingo/cards';

const FINGERPRINT = 'b'.repeat(64);

function anchor(overrides: Record<string, unknown> = {}) {
  return {
    normaKey: 'codice_civile',
    articleId: 'art_1453',
    urn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art1453',
    aknFingerprint: FINGERPRINT,
    ...overrides,
  };
}

function cardInput(overrides: Record<string, unknown> = {}) {
  return {
    materia: 'DIRITTO_CIVILE',
    istituto: 'Risoluzione per inadempimento',
    domanda: 'Quando il contratto può essere risolto per inadempimento?',
    risposta: "Quando l'inadempimento della controparte non è di scarsa importanza.",
    ancore: [anchor()],
    ...overrides,
  };
}

describe('createLingoCard', () => {
  let author: TestUser;
  beforeEach(async () => {
    author = await createTestUser('lingo-card-author');
  });

  it('creates the card as a personal draft, with its anchors, in one go', async () => {
    const created = await createLingoCard(author.id, cardInput({ ancore: [anchor(), anchor({ articleId: 'art_1455' })] }));

    expect(created.autoreId).toBe(author.id);
    expect(created.stato).toBe('BOZZA_PERSONALE');
    expect(created.tipo).toBe('ISTITUTO_DEFINIZIONE');
    expect(created.authorityScore).toBe(0);
    expect(created.isControversa).toBe(false);
    expect(created.ancore).toHaveLength(2);
    for (const a of created.ancore) expect(a.cardId).toBe(created.id);
    expect(await prisma.lingoCard.count()).toBe(1);
    expect(await prisma.lingoCardAncora.count()).toBe(2);
  });

  it('makes the first anchor the primary one when none is marked', async () => {
    const created = await createLingoCard(author.id, cardInput({ ancore: [anchor(), anchor({ articleId: 'art_1455' })] }));
    const byArticle = Object.fromEntries(created.ancore.map((a) => [a.articleId, a.isPrimary]));
    expect(byArticle).toEqual({ art_1453: true, art_1455: false });
  });

  it('keeps the anchor the author marked as primary', async () => {
    const created = await createLingoCard(
      author.id,
      cardInput({ ancore: [anchor(), anchor({ articleId: 'art_1455', isPrimary: true })] })
    );
    const byArticle = Object.fromEntries(created.ancore.map((a) => [a.articleId, a.isPrimary]));
    expect(byArticle).toEqual({ art_1453: false, art_1455: true });
  });

  it('an anchor written without saying so is not primary: only the service decides which one is', async () => {
    const created = await createLingoCard(author.id, cardInput());
    const stray = await prisma.lingoCardAncora.create({
      data: { cardId: created.id, normaKey: 'codice_civile', articleId: 'art_1455', urn: 'urn:x', aknFingerprint: FINGERPRINT },
    });
    expect(stray.isPrimary).toBe(false);
  });

  it('refuses a card without a norm and writes nothing', async () => {
    await expect(createLingoCard(author.id, cardInput({ ancore: [] }))).rejects.toBeInstanceOf(ZodError);
    expect(await prisma.lingoCard.count()).toBe(0);
  });

  it('refuses a bad fingerprint and writes nothing, not even the card', async () => {
    const bad = cardInput({ ancore: [anchor(), anchor({ articleId: 'art_1455', aknFingerprint: 'not-a-hash' })] });
    await expect(createLingoCard(author.id, bad)).rejects.toBeInstanceOf(ZodError);
    expect(await prisma.lingoCard.count()).toBe(0);
    expect(await prisma.lingoCardAncora.count()).toBe(0);
  });

  it('refuses to let the caller choose the state', async () => {
    await expect(createLingoCard(author.id, cardInput({ stato: 'VALIDATA' }))).rejects.toBeInstanceOf(ZodError);
    expect(await prisma.lingoCard.count()).toBe(0);
  });

  it('writes nothing when the author does not exist', async () => {
    await expect(createLingoCard('00000000-0000-4000-8000-000000000000', cardInput())).rejects.toThrow();
    expect(await prisma.lingoCard.count()).toBe(0);
    expect(await prisma.lingoCardAncora.count()).toBe(0);
  });

  it('goes away, with its anchors, when its author deletes the account', async () => {
    await createLingoCard(author.id, cardInput());
    expect(await prisma.lingoCard.count()).toBe(1);

    await prisma.user.delete({ where: { id: author.id } });

    expect(await prisma.lingoCard.count()).toBe(0);
    expect(await prisma.lingoCardAncora.count()).toBe(0);
  });
});
