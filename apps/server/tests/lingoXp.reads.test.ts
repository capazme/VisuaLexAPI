import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';
import { addDays } from '../src/lingo/studyDay';
import {
  PREFS, SESSION, card, cards, createTestUser, creditByHand, credits, grade, gradeAll, logged, makeValidator, preferences,
  prisma, progress, request, app, reviewed, session, setClock, storedDay, vote, type Headers, type TestUser,
} from './xpHelpers';

// The reads (Gymnasium XP spec §5.1, §5.3): the progress read settles first and answers the level, the missions
// and the credits it wrote; the session read settles a day that counts by its empty queue; «fatta» ⇔ a credit.

const TODAY = '2026-10-20';
let alice: TestUser;
let a: Headers;

beforeEach(async () => {
  setClock(`${TODAY}T08:00:00Z`);
  alice = await createTestUser('xp_reads');
  a = session(alice);
});
afterEach(() => {
  vi.useRealTimers();
});

type Missione = { id: string; stato: string; progresso?: { fatte: number; di: number }; materia?: string; motivo?: string };
const mission = (body: { missioni: Missione[] }, id: string) => body.missioni.find((m) => m.id === id);

describe('the progress read', () => {
  it('answers the level, the catalogue’s missions and the credits it wrote', async () => {
    const body = (await progress(a)).body;
    expect(body.livello).toEqual({ livello: 1, totale: 0, nelLivello: 0, perIlProssimo: 100, oggi: 0 });
    expect(body.crediti).toEqual([]);
    expect(body.missioni.map((m: Missione) => m.id)).toEqual(['dovute', 'nuove', 'obiettivo', 'materia-ferma', 'scrivi', 'caso', 'settimana', 'consolida']);
    expect(body.missioni).toEqual([
      { id: 'dovute', gruppo: 'giornaliera', principale: true, punti: 20, stato: 'vuota' },
      { id: 'nuove', gruppo: 'giornaliera', principale: true, punti: 15, stato: 'vuota' },
      { id: 'obiettivo', gruppo: 'giornaliera', principale: true, punti: 10, stato: 'vuota' },
      { id: 'materia-ferma', gruppo: 'giornaliera', principale: false, punti: 15, stato: 'vuota' },
      { id: 'scrivi', gruppo: 'giornaliera', principale: false, punti: 25, stato: 'aperta' },
      { id: 'caso', gruppo: 'giornaliera', principale: false, punti: 40, stato: 'in-arrivo' },
      { id: 'settimana', gruppo: 'settimanale', principale: false, punti: 50, stato: 'aperta', progresso: { fatte: 0, di: 7 } },
      { id: 'consolida', gruppo: 'lungo', principale: false, punti: 100, stato: 'aperta', progresso: { fatte: 0, di: 50 } },
    ]);
  });

  it('lists «convalida» to a validator only, «vuota» with nothing to vote on, its progress only with a vote to count', async () => {
    const carol = await makeValidator('xp_reads_carol');
    const c = session(carol, 'c');
    // A «vuota» with nothing to count carries no progress (spec §5.3).
    expect(mission((await progress(c)).body, 'convalida')).toEqual({
      id: 'convalida', gruppo: 'giornaliera', principale: false, punti: 20, stato: 'vuota',
    });
    const first = await card(alice, 'DIRITTO_CIVILE', 'PROPOSTA_COMMUNITY');
    expect(mission((await progress(c)).body, 'convalida')).toEqual({
      id: 'convalida', gruppo: 'giornaliera', principale: false, punti: 20, stato: 'aperta', progresso: { fatte: 0, di: 2 },
    });
    await vote(c, first.id);
    expect(mission((await progress(c)).body, 'convalida')).toMatchObject({ stato: 'vuota', progresso: { fatte: 1, di: 2 } });
    expect(mission((await progress(a)).body, 'convalida')).toBeUndefined();
  });

  it('answers the whole day’s missions, level and credits whatever the subject asked', async () => {
    const fresh = await cards(alice, 6);
    await gradeAll(a, fresh.slice(0, 5).map((c) => c.id));
    const whole = (await progress(a)).body;
    const narrowed = (await progress(a, 'DIRITTO_PENALE')).body;
    expect(narrowed.missioni).toEqual(whole.missioni);
    expect(narrowed.livello).toEqual(whole.livello);
    expect(narrowed.crediti).toEqual(whole.crediti);
    expect(mission(whole, 'nuove')).toMatchObject({ stato: 'fatta', progresso: { fatte: 5, di: 5 } });
  });

  it('credits once a mission fulfilled with no grade: the due cards left only in a subject switched off', async () => {
    await preferences(alice, { materieComunita: ['DIRITTO_PENALE'] });
    const author = await createTestUser('xp_reads_author');
    const community = await card(author, 'DIRITTO_PENALE', 'VALIDATA');
    await reviewed(alice, community.id, TODAY, new Date('2026-10-17T08:00:00Z'));
    const own = await card(alice);
    await reviewed(alice, own.id, TODAY, new Date('2026-10-17T08:00:00Z'));
    expect((await grade(a, own.id)).body.xp.crediti.map((c: { missione: string }) => c.missione)).not.toContain('dovute');
    expect(mission((await progress(a)).body, 'dovute')).toMatchObject({ stato: 'aperta', progresso: { fatte: 1, di: 2 } });

    // The accepted hole (spec §3.3): switching the subject off empties the due queue; bounded to once a day.
    await request(app).put(PREFS).set(a).send({ materieComunita: [] });
    const first = (await progress(a)).body;
    expect(first.crediti).toContainEqual({ missione: 'dovute', punti: 20 });
    expect(mission(first, 'dovute')).toMatchObject({ stato: 'fatta', progresso: { fatte: 1, di: 1 } });
    const second = (await progress(a)).body;
    expect(second.crediti).toEqual([]);
    expect((await credits(alice)).filter((r) => r.missione === 'DOVUTE')).toMatchObject([{ fonte: 'LETTURA', fonteId: null }]);
  });

  it('shows a mission «fatta» if and only if its credit exists', async () => {
    const carol = await makeValidator('xp_reads_fatta');
    const c = session(carol, 'c');
    const before = (await progress(c)).body.missioni as Missione[];
    expect(before.filter((m) => m.stato === 'fatta')).toEqual([]);
    for (const [missione, periodo] of [['DOVUTE', `G:${TODAY}`], ['NUOVE', `G:${TODAY}`], ['OBIETTIVO', `G:${TODAY}`], ['MATERIA_FERMA', `G:${TODAY}`],
      ['SCRIVI', `G:${TODAY}`], ['CONVALIDA', `G:${TODAY}`], ['SETTIMANA', 'S:2026-10-19'], ['CONSOLIDA', 'U']] as const) {
      await creditByHand(carol, missione, periodo, TODAY, 1, missione === 'SCRIVI' ? 'PROPOSTA' : 'LETTURA', missione === 'SCRIVI' ? 'card-x' : null);
    }
    const after = (await progress(c)).body.missioni as Missione[];
    expect(after.filter((m) => m.stato !== 'fatta').map((m) => m.id)).toEqual(['caso']);
    // Yesterday's credit of a daily mission is not today's.
    const dave = await createTestUser('xp_reads_yesterday');
    await creditByHand(dave, 'SCRIVI', `G:${addDays(TODAY, -1)}`, addDays(TODAY, -1), 25, 'PROPOSTA', 'card-y');
    expect(mission((await progress(session(dave, 'd'))).body, 'scrivi')).toMatchObject({ stato: 'aperta' });
  });

  it('names the subject being studied for «materia-ferma», and otherwise the one left longest', async () => {
    const penal = await cards(alice, 5, 'DIRITTO_PENALE');
    const admin = await cards(alice, 5, 'DIRITTO_AMMINISTRATIVO');
    for (const c of penal) { await logged(alice, c.id, '2026-10-10T10:00:00Z'); await reviewed(alice, c.id, TODAY, new Date('2026-10-10T10:00:00Z')); }
    for (const c of admin) { await logged(alice, c.id, '2026-10-08T10:00:00Z'); await reviewed(alice, c.id, TODAY, new Date('2026-10-08T10:00:00Z')); }
    expect(mission((await progress(a)).body, 'materia-ferma')).toMatchObject({ stato: 'aperta', materia: 'DIRITTO_AMMINISTRATIVO', progresso: { fatte: 0, di: 5 } });
    await gradeAll(a, penal.slice(0, 3).map((c) => c.id));
    expect(mission((await progress(a)).body, 'materia-ferma')).toMatchObject({ stato: 'aperta', materia: 'DIRITTO_PENALE', progresso: { fatte: 3, di: 5 } });
    await gradeAll(a, penal.slice(3).map((c) => c.id));
    expect(mission((await progress(a)).body, 'materia-ferma')).toMatchObject({ stato: 'fatta', materia: 'DIRITTO_PENALE', progresso: { fatte: 5, di: 5 } });
  });

  it('leaves a subject that cannot reach five reviews today out of «materia-ferma»', async () => {
    const penal = await cards(alice, 4, 'DIRITTO_PENALE');
    for (const c of penal) { await logged(alice, c.id, '2026-10-10T10:00:00Z'); await reviewed(alice, c.id, TODAY, new Date('2026-10-10T10:00:00Z')); }
    expect(mission((await progress(a)).body, 'materia-ferma')).toMatchObject({ stato: 'vuota' });
  });

  it('leaves out of the calendar a day row written only by votes', async () => {
    const carol = await makeValidator('xp_reads_calendar');
    const c = session(carol, 'c');
    await vote(c, (await card(alice, 'DIRITTO_CIVILE', 'PROPOSTA_COMMUNITY')).id);
    expect(await prisma.lingoGiornataStudio.count({ where: { utenteId: carol.id } })).toBe(1);
    expect((await progress(c)).body.calendario).toEqual([]);
    expect((await progress(c, 'DIRITTO_CIVILE')).body.calendario).toEqual([]);
    // A day with reviews still shows.
    await storedDay(carol, addDays(TODAY, -1), { ripassi: 3 });
    expect((await progress(c)).body.calendario.map((d: { giorno: string }) => d.giorno)).toEqual([addDays(TODAY, -1)]);
  });

  it('does not deadlock with the account’s deletion', async () => {
    // The case of spec §5.1: today's row exists, so marking the queue finished is an UPDATE that touches no
    // foreign key, and the read then writes a credit («obiettivo», nothing left), whose insert needs the user row.
    for (let i = 0; i < 10; i++) {
      const user = await createTestUser(`xp_reads_gone_${i}`);
      const done = await card(user);
      await reviewed(user, done.id, '2026-10-25', new Date('2026-10-17T08:00:00Z')); // studied, nothing due: the queue is finished
      await storedDay(user, TODAY, { ripassi: 3 });
      const [read] = await Promise.all([progress(session(user, `g${i}`)), deleteUserAccount(user.id)]);
      expect([200, 401]).toContain(read.status);
      expect(await prisma.lingoCreditoXp.count({ where: { utenteId: user.id } })).toBe(0);
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    }
  });
});

describe('the session read', () => {
  it('credits the week of a day that counts only because nothing is left to do', async () => {
    for (let i = 1; i <= 6; i++) await storedDay(alice, addDays(TODAY, -i), { ripassi: 10, valido: true });
    const done = await card(alice);
    await reviewed(alice, done.id, '2026-10-25', new Date('2026-10-19T08:00:00Z'));
    const response = await request(app).get(SESSION).set(a);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['cards', 'conteggi']);
    expect(await credits(alice)).toMatchObject([{ missione: 'SETTIMANA', periodo: 'S:2026-10-19', fonte: 'LETTURA' }]);
    const read = (await progress(a)).body;
    expect(read.crediti).toEqual([]);
    expect(mission(read, 'settimana')).toMatchObject({ stato: 'fatta', progresso: { fatte: 7, di: 7 } });
    // Zero reviews today: the goal's mission waits for a review (spec §5.1 «obiettivo»).
    expect(mission(read, 'obiettivo')).toMatchObject({ stato: 'vuota' });
  });

  it('settles nothing when narrowed to a subject', async () => {
    for (let i = 1; i <= 6; i++) await storedDay(alice, addDays(TODAY, -i), { ripassi: 10, valido: true });
    const done = await card(alice);
    await reviewed(alice, done.id, '2026-10-25', new Date('2026-10-19T08:00:00Z'));
    await request(app).get(`${SESSION}?materia=DIRITTO_CIVILE`).set(a);
    expect(await credits(alice)).toEqual([]);
  });
});
