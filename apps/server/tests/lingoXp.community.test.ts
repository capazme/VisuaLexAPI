import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  card, createTestUser, creditByHand, credits, makeValidator, prisma, propose, request, app, session, setClock, storedDay,
  vote, withdraw, type Headers, type TestUser,
} from './xpHelpers';

// Writing and validating for the community (Gymnasium XP spec §3.4, §3.5, §6.3): «scrivi» once per card in its
// life, «convalida» for the act and not the verdict, and a vote rule that never reads XP (G-253, G-318).

const TODAY = '2026-10-20';
afterEach(() => {
  vi.useRealTimers();
});

describe('«scrivi»: proposing a card (G-314)', () => {
  let alice: TestUser;
  let a: Headers;
  beforeEach(async () => {
    setClock(`${TODAY}T08:00:00Z`);
    alice = await createTestUser('xp_writer');
    a = session(alice);
  });

  it('credits 25 with the proposal, once a day, the card as its event', async () => {
    const one = await card(alice, 'DIRITTO_PENALE');
    const two = await card(alice);
    const first = await propose(a, one.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: one.id, stato: 'PROPOSTA_COMMUNITY' });
    expect(first.body.xp).toEqual({
      crediti: [{ missione: 'scrivi', punti: 25 }],
      livello: { livello: 1, totale: 25, nelLivello: 25, perIlProssimo: 100, oggi: 25 },
      nuovoLivello: false,
    });
    expect((await propose(a, two.id)).body.xp.crediti).toEqual([]);
    expect(await credits(alice)).toMatchObject([{ missione: 'SCRIVI', periodo: `G:${TODAY}`, fonte: 'PROPOSTA', fonteId: one.id, materia: 'DIRITTO_PENALE' }]);
  });

  it('pays a card once in its life: withdrawn and proposed again, today or later, it earns nothing', async () => {
    const one = await card(alice);
    await propose(a, one.id);
    await withdraw(a, one.id);
    expect((await propose(a, one.id)).body.xp.crediti).toEqual([]);
    setClock('2026-10-21T08:00:00Z');
    await withdraw(a, one.id);
    expect((await propose(a, one.id)).body.xp.crediti).toEqual([]);
    const two = await card(alice);
    expect((await propose(a, two.id)).body.xp.crediti).toEqual([{ missione: 'scrivi', punti: 25 }]);
  });

  it('writes nothing when the notice must be accepted first', async () => {
    const one = await card(alice);
    const response = await request(app).post(`/api/lingo/cards/${one.id}/proponi`).set(a).send({});
    expect(response.status).toBe(409);
    expect(response.body).not.toHaveProperty('xp');
    expect(await credits(alice)).toEqual([]);
  });

  it('never credits a review mission', async () => {
    await storedDay(alice, TODAY, { ripassi: 10, valido: true }); // «dovute» and «obiettivo» fulfilled
    const one = await card(alice);
    expect((await propose(a, one.id)).body.xp.crediti).toEqual([{ missione: 'scrivi', punti: 25 }]);
  });

  it('takes nothing back when the validators archive the card', async () => {
    const one = await card(alice);
    await propose(a, one.id);
    const carol = await makeValidator('xp_writer_carol');
    expect((await vote(session(carol, 'c'), one.id, 'ERRATA')).body.stato).toBe('ARCHIVIATA');
    expect(await credits(alice)).toHaveLength(1);
  });
});

describe('«convalida»: two votes a day, whatever the verdict', () => {
  let alice: TestUser;
  let carol: TestUser;
  let c: Headers;
  beforeEach(async () => {
    setClock(`${TODAY}T08:00:00Z`);
    alice = await createTestUser('xp_author');
    carol = await makeValidator('xp_validator');
    c = session(carol, 'c');
  });
  const proposed = (author: TestUser | null = alice) => card(author, 'DIRITTO_CIVILE', 'PROPOSTA_COMMUNITY');
  const votesToday = async (user: TestUser) =>
    (await prisma.lingoGiornataStudio.findUnique({ where: { utenteId_giorno: { utenteId: user.id, giorno: new Date(`${TODAY}T00:00:00Z`) } } }))?.voti ?? 0;

  it('credits the second vote, with the vote as its event, and not the third', async () => {
    const [one, two, three] = [await proposed(), await proposed(), await proposed()];
    const first = await vote(c, one.id);
    expect(first.body).toEqual({ stato: 'PROPOSTA_COMMUNITY', xp: expect.objectContaining({ crediti: [] }) });
    const second = await vote(c, two.id, 'ERRATA');
    expect(second.body.xp.crediti).toEqual([{ missione: 'convalida', punti: 20 }]);
    expect((await vote(c, three.id, 'MIGLIORABILE')).body.xp.crediti).toEqual([]);
    const theVote = await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { cardId: two.id } });
    expect(await credits(carol)).toMatchObject([{ missione: 'CONVALIDA', fonte: 'VOTO', fonteId: theVote.id, materia: null }]);
    expect(await votesToday(carol)).toBe(3);
  });

  it('credits exactly once when the first two votes arrive together', async () => {
    const [one, two] = [await proposed(), await proposed()];
    const both = await Promise.all([vote(c, one.id), vote(c, two.id)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both.flatMap((r) => r.body.xp.crediti)).toEqual([{ missione: 'convalida', punti: 20 }]);
    expect(await credits(carol)).toHaveLength(1);
  });

  it('keeps counting a vote whose proposal was withdrawn, and the vote that deletes an authorless card', async () => {
    const withdrawn = await proposed();
    await vote(c, withdrawn.id);
    await withdraw(session(alice, 'a'), withdrawn.id);
    expect(await prisma.lingoValidazioneCard.count({ where: { utenteId: carol.id } })).toBe(0);
    expect(await votesToday(carol)).toBe(1);
    const authorless = await proposed(null);
    const archiving = await vote(c, authorless.id, 'ERRATA');
    expect(archiving.body.stato).toBe('ARCHIVIATA');
    expect(await prisma.lingoCard.findUnique({ where: { id: authorless.id } })).toBeNull();
    expect(archiving.body.xp.crediti).toEqual([{ missione: 'convalida', punti: 20 }]);
  });

  it('counts no refused vote', async () => {
    const own = await card(carol, 'DIRITTO_CIVILE', 'PROPOSTA_COMMUNITY');
    expect((await vote(c, own.id)).status).toBe(403);
    const one = await proposed();
    await vote(c, one.id);
    expect((await vote(c, one.id)).status).toBe(409);
    const draft = await card(alice);
    expect((await vote(c, draft.id)).status).toBe(404);
    const dave = await createTestUser('xp_not_validator');
    expect((await vote(session(dave, 'd'), (await proposed()).id)).status).toBe(403);
    expect(await votesToday(carol)).toBe(1);
    expect(await votesToday(dave)).toBe(0);
    expect(await credits(carol)).toEqual([]);
  });
});

describe('the vote rule stays blind to XP (G-253, G-318)', () => {
  it('does not import the missions, the level or the ledger', () => {
    for (const file of ['validationRule.ts', 'validationSettings.ts']) {
      const source = readFileSync(join(__dirname, '../src/lingo', file), 'utf8');
      expect(source).not.toMatch(/from '\.\/(missions|levels|xpLedger)'/);
    }
  });

  it('gives the same outcome whatever the voters’ levels', async () => {
    setClock(`${TODAY}T08:00:00Z`);
    const author = await createTestUser('xp_rule_author');
    const [novice1, novice2, expert1, expert2] = [
      await makeValidator('xp_rule_n1'), await makeValidator('xp_rule_n2'), await makeValidator('xp_rule_e1'), await makeValidator('xp_rule_e2'),
    ];
    for (const expert of [expert1, expert2]) await creditByHand(expert, 'CONSOLIDA', 'U', '2026-09-01', 1000);
    const outcome = async (voters: TestUser[], verdicts: ('APPROVATA' | 'MIGLIORABILE' | 'ERRATA')[]) => {
      const target = await card(author, 'DIRITTO_CIVILE', 'PROPOSTA_COMMUNITY');
      let stato = '';
      for (let i = 0; i < voters.length; i++) stato = (await vote(session(voters[i], `v${i}`), target.id, verdicts[i])).body.stato;
      return stato;
    };
    for (const verdicts of [['APPROVATA', 'APPROVATA'], ['APPROVATA', 'MIGLIORABILE'], ['MIGLIORABILE', 'ERRATA']] as const) {
      expect(await outcome([novice1, novice2], [...verdicts])).toBe(await outcome([expert1, expert2], [...verdicts]));
    }
  });
});
