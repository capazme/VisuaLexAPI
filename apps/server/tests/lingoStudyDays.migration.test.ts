import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, createTestUser, type TestUser } from './helpers';

// The migration 20261022100000_lingo_study_days (Studia progress spec §5.1): its backfill of the stored days
// from the review log, and the bounds of the review goal. The setup has applied every migration to an empty
// database, so the backfill is run again here, read from the migration file, over a log written by hand.

const MIGRATION = join(__dirname, '../prisma/migrations/20261022100000_lingo_study_days/migration.sql');

function backfillSql(): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('INSERT INTO "lingo_giornate_studio"');
  if (start < 0) throw new Error('the migration has no backfill');
  return sql.slice(start);
}

let sequence = 0;
async function card(author: TestUser) {
  sequence += 1;
  return prisma.lingoCard.create({
    data: { autoreId: author.id, materia: 'DIRITTO_CIVILE', istituto: `Istituto ${sequence}`, domanda: `Domanda ${sequence}?`, risposta: `Risposta ${sequence}.` },
  });
}

async function logged(user: TestUser, cardId: string, at: string, rating: number) {
  await prisma.lingoRevisioneSRS.create({
    data: { utenteId: user.id, cardId, dataRevisione: new Date(at), rating, scheduledDays: 1, stability: 1, difficulty: 5 },
  });
}

async function storedDays(user: TestUser) {
  const rows = await prisma.lingoGiornataStudio.findMany({ where: { utenteId: user.id }, orderBy: { giorno: 'asc' } });
  return rows.map((row) => ({
    giorno: row.giorno.toISOString().slice(0, 10),
    ripassi: row.ripassi,
    nuove: row.nuove,
    sbagliate: row.sbagliate,
    codaFinita: row.codaFinita,
    valido: row.valido,
  }));
}

describe('the migration of the stored study days', () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeEach(async () => {
    sequence = 0;
    alice = await createTestUser('days-alice');
    bob = await createTestUser('days-bob');
  });

  it('fills each Rome day from the log: reviews, first reviews, wrong ones, across the end of summer time', async () => {
    const one = await card(alice);
    const two = await card(alice);
    // Summer time ends on 25 October 2026 at 01:00 UTC: Rome is UTC+2 before, UTC+1 after.
    await logged(alice, one.id, '2026-10-24T21:30:00Z', 3); // 23:30 on the 24th
    await logged(alice, two.id, '2026-10-24T22:30:00Z', 1); // 00:30 on the 25th
    await logged(alice, one.id, '2026-10-25T22:30:00Z', 3); // 23:30 on the 25th
    await logged(alice, two.id, '2026-10-25T23:30:00Z', 4); // 00:30 on the 26th
    // Ten reviews in one day reach the default goal.
    for (let i = 0; i < 10; i++) await logged(bob, (await card(bob)).id, `2026-10-20T08:00:${String(i).padStart(2, '0')}Z`, 3);

    await prisma.$executeRawUnsafe(backfillSql());

    expect(await storedDays(alice)).toEqual([
      { giorno: '2026-10-24', ripassi: 1, nuove: 1, sbagliate: 0, codaFinita: false, valido: false },
      { giorno: '2026-10-25', ripassi: 2, nuove: 1, sbagliate: 1, codaFinita: false, valido: false },
      { giorno: '2026-10-26', ripassi: 1, nuove: 0, sbagliate: 0, codaFinita: false, valido: false },
    ]);
    expect(await storedDays(bob)).toEqual([
      { giorno: '2026-10-20', ripassi: 10, nuove: 10, sbagliate: 0, codaFinita: false, valido: true },
    ]);
  });

  it('reads the start of summer time too', async () => {
    const one = await card(alice);
    // Summer time starts on 28 March 2027 at 01:00 UTC: 22:30 UTC on the 27th is 23:30 in Rome, on the 28th 00:30 the next day.
    await logged(alice, one.id, '2027-03-27T22:30:00Z', 3);
    await logged(alice, one.id, '2027-03-28T22:30:00Z', 3);

    await prisma.$executeRawUnsafe(backfillSql());

    expect((await storedDays(alice)).map((d) => d.giorno)).toEqual(['2027-03-27', '2027-03-29']);
  });

  it('holds the review goal between 1 and 200, 10 by default', async () => {
    const created = await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id } });
    expect(created.ripassiAlGiorno).toBe(10);
    await expect(prisma.lingoPreferenzeStudio.update({ where: { utenteId: alice.id }, data: { ripassiAlGiorno: 0 } })).rejects.toThrow();
    await expect(prisma.lingoPreferenzeStudio.update({ where: { utenteId: alice.id }, data: { ripassiAlGiorno: 201 } })).rejects.toThrow();
    await expect(prisma.lingoPreferenzeStudio.update({ where: { utenteId: alice.id }, data: { ripassiAlGiorno: 200 } })).resolves.toMatchObject({ ripassiAlGiorno: 200 });
  });

  it('goes with the account', async () => {
    await prisma.lingoGiornataStudio.create({ data: { utenteId: alice.id, giorno: new Date('2026-10-20T00:00:00Z'), ripassi: 3 } });
    await prisma.user.delete({ where: { id: alice.id } });
    expect(await prisma.lingoGiornataStudio.count()).toBe(0);
  });
});
