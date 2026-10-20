import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../src/lingo/studyDay';
import {
  app, card, cards, createTestUser, creditByHand, credits, grade, gradeAll, logged, preferences, prisma, progress, request, reviewed,
  session, setClock, storedDay, type Headers, type TestUser,
} from './xpHelpers';

// The missions a grade evaluates (Gymnasium XP spec §3.1, §3.3, §5.1): each fulfilled exactly at its threshold,
// the floors that the user's settings cannot lower, and the credit's day and period in Rome days.

const TODAY = '2026-10-20'; // a Tuesday
let alice: TestUser;
let a: Headers;

beforeEach(async () => {
  setClock(`${TODAY}T08:00:00Z`);
  alice = await createTestUser('xp_review');
  a = session(alice);
});
afterEach(() => {
  vi.useRealTimers();
});

const missionsOf = (body: { xp?: { crediti: { missione: string }[] } }) => (body.xp?.crediti ?? []).map((c) => c.missione);
/** Cards due today, last reviewed `lastDay`. */
async function dueCards(n: number, lastDay = '2026-10-17', materia: Parameters<typeof card>[1] = 'DIRITTO_CIVILE') {
  const made = [];
  for (let i = 0; i < n; i++) {
    const c = await card(alice, materia);
    await reviewed(alice, c.id, TODAY, new Date(`${lastDay}T08:00:00Z`));
    made.push(c);
  }
  return made;
}

describe('«dovute»', () => {
  it('is credited by the grade that leaves nothing due, with the log row as its event', async () => {
    const [one, two] = await dueCards(2);
    expect(missionsOf((await grade(a, one.id)).body)).not.toContain('dovute');
    const closing = await grade(a, two.id);
    expect(missionsOf(closing.body)).toContain('dovute');
    const log = await prisma.lingoRevisioneSRS.findFirstOrThrow({ where: { utenteId: alice.id, cardId: two.id } });
    const row = (await credits(alice)).find((r) => r.missione === 'DOVUTE')!;
    expect(row).toMatchObject({ periodo: `G:${TODAY}`, punti: 20, fonte: 'REVISIONE', fonteId: log.id, materia: null });
  });
});

describe('«nuove»', () => {
  it('needs five first reviews', async () => {
    const fresh = await cards(alice, 10);
    const answers = await gradeAll(a, fresh.slice(0, 5).map((c) => c.id));
    expect(answers.slice(0, 4).flatMap((r) => missionsOf(r.body))).not.toContain('nuove');
    expect(missionsOf(answers[4].body)).toContain('nuove');
  });

  it('asks for what is left in the scope when fewer than five', async () => {
    const fresh = await cards(alice, 3);
    const answers = await gradeAll(a, fresh.map((c) => c.id));
    expect(missionsOf(answers[1].body)).not.toContain('nuove');
    expect(missionsOf(answers[2].body)).toContain('nuove');
  });
});

describe('«obiettivo»', () => {
  it('needs the goal’s reviews, ten by default', async () => {
    const fresh = await cards(alice, 15);
    const answers = await gradeAll(a, fresh.slice(0, 10).map((c) => c.id));
    expect(answers.slice(0, 9).flatMap((r) => missionsOf(r.body))).not.toContain('obiettivo');
    expect(missionsOf(answers[9].body)).toContain('obiettivo');
  });

  it('follows a goal above ten', async () => {
    await preferences(alice, { ripassiAlGiorno: 12 });
    const fresh = await cards(alice, 15);
    const answers = await gradeAll(a, fresh.slice(0, 12).map((c) => c.id));
    expect(answers.slice(0, 11).flatMap((r) => missionsOf(r.body))).not.toContain('obiettivo');
    expect(missionsOf(answers[11].body)).toContain('obiettivo');
  });
});

describe('the settings cannot lower a target (spec §3.3, L-27 choice 5)', () => {
  it('a quota of 1 and a goal of 1 earn neither «nuove» nor «obiettivo» for two reviews, and the day still counts', async () => {
    await preferences(alice, { nuoveAlGiorno: 1, ripassiAlGiorno: 1 });
    const [due] = await dueCards(1);
    const fresh = await cards(alice, 10);
    const answers = await gradeAll(a, [due.id, fresh[0].id]);
    const earned = answers.flatMap((r) => missionsOf(r.body));
    expect(earned).not.toContain('nuove');
    expect(earned).not.toContain('obiettivo');
    expect(answers[1].body.oggi).toMatchObject({ raggiunto: true, serie: 1 });
    const nuove = (await progress(a)).body.missioni.find((m: { id: string }) => m.id === 'nuove');
    expect(nuove).toMatchObject({ stato: 'aperta', progresso: { fatte: 1, di: 5 }, motivo: 'quota' });
  });

  it('a user with fewer cards than the floor earns «obiettivo» once nothing is left', async () => {
    const fresh = await cards(alice, 3);
    const answers = await gradeAll(a, fresh.map((c) => c.id));
    expect(missionsOf(answers[2].body)).toEqual(expect.arrayContaining(['nuove', 'obiettivo']));
  });
});

describe('«materia-ferma»', () => {
  async function staleSubject(lastAt: string) {
    const penal = await dueCards(5, '2026-10-12', 'DIRITTO_PENALE');
    for (const c of penal) await logged(alice, c.id, lastAt);
    return penal;
  }

  it('credits the fifth review today in a subject last reviewed seven days ago', async () => {
    const penal = await staleSubject('2026-10-13T10:00:00Z');
    const answers = await gradeAll(a, penal.map((c) => c.id));
    expect(answers.slice(0, 4).flatMap((r) => missionsOf(r.body))).not.toContain('materia-ferma');
    expect(missionsOf(answers[4].body)).toContain('materia-ferma');
    expect((await credits(alice)).find((r) => r.missione === 'MATERIA_FERMA')).toMatchObject({ materia: 'DIRITTO_PENALE', punti: 15 });
  });

  it('reads the last review’s day in Rome: 23:30 on the 13th qualifies, 00:30 on the 14th does not', async () => {
    const penal = await staleSubject('2026-10-13T21:30:00Z'); // 23:30 in Rome (summer time)
    expect(missionsOf((await gradeAll(a, penal.map((c) => c.id)))[4].body)).toContain('materia-ferma');

    const bob = await createTestUser('xp_review_bob');
    const b = session(bob, 'bob');
    const civil = [];
    for (let i = 0; i < 5; i++) {
      const c = await card(bob, 'DIRITTO_PENALE');
      await reviewed(bob, c.id, TODAY, new Date('2026-10-12T08:00:00Z'));
      await logged(bob, c.id, '2026-10-13T22:30:00Z'); // 00:30 on the 14th in Rome: six days ago
      civil.push(c);
    }
    expect((await gradeAll(b, civil.map((c) => c.id))).flatMap((r) => missionsOf(r.body))).not.toContain('materia-ferma');
  });

  it('does not credit a subject last reviewed six days ago', async () => {
    const penal = await staleSubject('2026-10-14T10:00:00Z');
    expect((await gradeAll(a, penal.map((c) => c.id))).flatMap((r) => missionsOf(r.body))).not.toContain('materia-ferma');
  });

  it('does not credit a subject never reviewed before', async () => {
    const fresh = await cards(alice, 5, 'DIRITTO_PENALE');
    expect((await gradeAll(a, fresh.map((c) => c.id))).flatMap((r) => missionsOf(r.body))).not.toContain('materia-ferma');
  });
});

describe('«settimana»', () => {
  async function countedBefore(days: string[]) {
    for (const day of days) await storedDay(alice, day, { ripassi: 10, valido: true });
  }
  const daysBefore = (n: number, skip: string[] = []) =>
    Array.from({ length: n }, (_, i) => addDays(TODAY, -(i + 1))).filter((d) => !skip.includes(d));

  it('credits the day the streak reaches seven, in the period of this week’s Monday', async () => {
    await preferences(alice, { ripassiAlGiorno: 1 });
    await countedBefore(daysBefore(6));
    const [due] = await dueCards(1);
    const answer = await grade(a, due.id);
    expect(answer.body.oggi.serie).toBe(7);
    expect(missionsOf(answer.body)).toContain('settimana');
    expect((await credits(alice)).find((r) => r.missione === 'SETTIMANA')).toMatchObject({ periodo: 'S:2026-10-19', punti: 50 });
  });

  it('does not credit at eight', async () => {
    await preferences(alice, { ripassiAlGiorno: 1 });
    await countedBefore(daysBefore(7));
    const [due] = await dueCards(1);
    const answer = await grade(a, due.id);
    expect(answer.body.oggi.serie).toBe(8);
    expect(missionsOf(answer.body)).not.toContain('settimana');
  });

  it('credits at fourteen with a rest day inside the run', async () => {
    await preferences(alice, { ripassiAlGiorno: 1 });
    await countedBefore(daysBefore(14, ['2026-10-10']));
    const [due] = await dueCards(1);
    const answer = await grade(a, due.id);
    expect(answer.body.oggi.serie).toBe(14);
    expect(missionsOf(answer.body)).toContain('settimana');
  });

  it('credits again in the next week, whose period is its own Monday', async () => {
    await creditByHand(alice, 'SETTIMANA', 'S:2026-10-19', '2026-10-19', 50);
    setClock('2026-10-26T08:00:00Z'); // the next Monday
    await preferences(alice, { ripassiAlGiorno: 1 });
    for (let i = 1; i <= 6; i++) await storedDay(alice, addDays('2026-10-26', -i), { ripassi: 10, valido: true });
    const c = await card(alice);
    await reviewed(alice, c.id, '2026-10-26', new Date('2026-10-23T08:00:00Z'));
    const answer = await grade(a, c.id);
    expect(missionsOf(answer.body)).toContain('settimana');
    expect((await credits(alice)).filter((r) => r.missione === 'SETTIMANA').map((r) => r.periodo)).toEqual(['S:2026-10-19', 'S:2026-10-26']);
  });
});

describe('«consolida»', () => {
  async function consolidated(n: number) {
    for (let i = 0; i < n; i++) {
      const c = await card(alice);
      await reviewed(alice, c.id, '2026-11-05', new Date('2026-10-10T08:00:00Z')); // 26 days
    }
  }

  it('is read over the whole scope: 49 consolidated cards are not enough, 50 are', async () => {
    await consolidated(49);
    expect((await progress(a)).body.missioni.find((m: { id: string }) => m.id === 'consolida')).toMatchObject({ stato: 'aperta', progresso: { fatte: 49, di: 50 } });
    await consolidated(1);
    const read = await progress(a);
    expect(read.body.crediti).toContainEqual({ missione: 'consolida', punti: 100 });
    expect((await credits(alice)).find((r) => r.missione === 'CONSOLIDA')).toMatchObject({ periodo: 'U' });
  });

  it('is not evaluated by a grade whose interval is under 21 days', async () => {
    await consolidated(50);
    const [due] = await dueCards(1);
    const answer = await grade(a, due.id, 1);
    expect(answer.body.scheduledDays).toBeLessThan(21);
    expect(missionsOf(answer.body)).not.toContain('consolida');
  });
});

describe('what a grade settles', () => {
  it('settles nothing for a grade not recorded', async () => {
    const [due] = await dueCards(1);
    await grade(a, due.id);
    const before = await credits(alice);
    const again = await grade(a, due.id);
    expect(again.body.registrata).toBe(false);
    expect(again.body).not.toHaveProperty('xp');
    expect(await credits(alice)).toEqual(before);
  });

  it('credits each mission once when two grades close it at once', async () => {
    await preferences(alice, { ripassiAlGiorno: 2 });
    const [one, two] = await dueCards(2);
    const both = await Promise.all([grade(a, one.id), grade(a, two.id)]);
    const earned = both.flatMap((r) => missionsOf(r.body)).sort();
    const rows = await credits(alice);
    expect(earned).toEqual(rows.map((r) => r.missione.toLowerCase()).sort());
    expect(rows.filter((r) => r.missione === 'DOVUTE')).toHaveLength(1);
  });

  it('never credits «scrivi» or «convalida»', async () => {
    const fresh = await cards(alice, 5);
    const earned = (await gradeAll(a, fresh.map((c) => c.id))).flatMap((r) => missionsOf(r.body));
    expect(earned).not.toContain('scrivi');
    expect(earned).not.toContain('convalida');
  });
});

describe('Rome days', () => {
  // [the instant, its Rome day]: either side of midnight, on both daylight-saving weekends of 2026.
  const instants: [string, string][] = [
    ['2026-03-28T22:59:00Z', '2026-03-28'], // 23:59 CET
    ['2026-03-28T23:01:00Z', '2026-03-29'], // 00:01 CET, the night clocks go forward
    ['2026-03-29T21:59:00Z', '2026-03-29'], // 23:59 CEST
    ['2026-03-29T22:01:00Z', '2026-03-30'],
    ['2026-10-24T21:59:00Z', '2026-10-24'], // 23:59 CEST
    ['2026-10-24T22:01:00Z', '2026-10-25'], // 00:01 CEST, the night clocks go back
    ['2026-10-25T22:59:00Z', '2026-10-25'], // 23:59 CET
    ['2026-10-25T23:01:00Z', '2026-10-26'],
  ];
  it.each(instants)('a grade at %s credits on %s', async (instant, day) => {
    setClock(instant);
    const c = await card(alice);
    const answer = await grade(a, c.id);
    expect(missionsOf(answer.body)).toContain('nuove');
    const rows = await credits(alice);
    for (const row of rows) {
      expect(row.giorno.toISOString().slice(0, 10)).toBe(day);
      expect(row.periodo).toBe(`G:${day}`);
    }
  });
});

describe('the trash', () => {
  it('leaves the credits as they were when a studied card goes to the trash and comes back', async () => {
    const fresh = await cards(alice, 3);
    await gradeAll(a, fresh.map((c) => c.id));
    const before = await credits(alice);
    expect(before.length).toBeGreaterThan(0);
    const trashed = await request(app).post('/api/lingo/cards/trash').set(a).send({ cardIds: [fresh[0].id] });
    expect(trashed.status).toBe(200);
    expect(await credits(alice)).toEqual(before);
    const [entry] = (await request(app).get('/api/trash').set(a)).body;
    expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(a).send({})).status).toBe(200);
    expect((await progress(a)).body.crediti).toEqual([]);
    expect(await credits(alice)).toEqual(before);
  });
});
