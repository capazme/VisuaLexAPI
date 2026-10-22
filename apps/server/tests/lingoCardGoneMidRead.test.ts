import { createServer, connect, type Server, type Socket } from 'net';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteUserAccount } from '../src/lingo/deleteUserAccount';
import { card, createTestUser, prisma, request, reviewed, session, setClock, type TestUser } from './xpHelpers';

// A card can go while a read of the review states runs: the account's deletion takes the user's cards, an
// author's trash takes theirs, and the states go with them. Prisma reads a relation in two statements, the rows
// and then the related rows by id: a card gone between the two was a 500 («Field card is required to return data,
// got null»), at random (tests/lingoXp.reads.test.ts, «does not deadlock with the account's deletion»).
//
// Here the interleaving is forced. The reads run on a client of their own that talks to Postgres through a proxy;
// the proxy holds the second statement of a relation read between cards and review states, either way round,
// deletes the card for real, and only then lets the statement through. A fresh client parses each statement,
// so its SQL text is on the wire.

const TODAY = '2026-10-20';
const SECOND_STATEMENT = ['"public"."lingo_cards"."id" IN (', '"public"."lingo_stato_ripasso"."card_id" IN ('];

let alice: TestUser;
let proxy: Server;
let reader: PrismaClient;
let held: () => Promise<void>;
let holds = 0;

/** Forwards to the test database, holding the first chunk of a second statement until `held` is done. */
function startProxy(target: URL): Promise<Server> {
  const server = createServer((client: Socket) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    let queue = Promise.resolve();
    client.on('data', (chunk) => {
      queue = queue
        .then(async () => {
          const text = chunk.toString('latin1');
          if (SECOND_STATEMENT.some((marker) => text.includes(marker))) {
            holds += 1;
            await held();
          }
          upstream.write(chunk);
        })
        .catch(() => {
          client.destroy(); // a failed deletion ends the read at once, not at the test's timeout
        });
    });
    upstream.on('data', (chunk) => client.write(chunk));
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** `readProgress`, `readPercorso` and the review routes (on an app of their own) on the proxied client. */
async function reads() {
  vi.resetModules();
  vi.doMock('../src/lib/prisma', () => ({ prisma: reader }));
  const [{ readProgress }, { readPercorso }, { default: routes }] = await Promise.all([
    import('../src/lingo/progress'), import('../src/lingo/percorso'), import('../src/routes/lingoSrs'),
  ]);
  return { readProgress, readPercorso, srs: express().use(routes) };
}

beforeEach(async () => {
  setClock(`${TODAY}T08:00:00Z`);
  alice = await createTestUser('card_gone');
  const target = new URL(process.env.DATABASE_URL!);
  proxy = await startProxy(target);
  const port = (proxy.address() as { port: number }).port;
  const url = new URL(target.toString());
  url.host = `127.0.0.1:${port}`;
  url.searchParams.set('sslmode', 'disable');
  reader = new PrismaClient({ datasourceUrl: url.toString() });
  holds = 0;
});
afterEach(async () => {
  vi.doUnmock('../src/lib/prisma');
  vi.useRealTimers();
  await reader?.$disconnect();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
});

async function twoReviewed(dueDay = '2026-10-25') {
  const kept = await card(alice);
  const gone = await card(alice);
  await reviewed(alice, kept.id, dueDay, new Date('2026-10-17T08:00:00Z'));
  await reviewed(alice, gone.id, dueDay, new Date('2026-10-17T08:00:00Z'));
  return { kept, gone };
}

describe('a card gone between the two statements of a read', () => {
  it('the progress read answers without it', async () => {
    const { gone } = await twoReviewed();
    held = async () => {
      await prisma.lingoCard.deleteMany({ where: { id: gone.id } });
    };
    const { readProgress } = await reads();
    const read = await readProgress(alice.id);
    expect(holds).toBe(1);
    expect(await prisma.lingoStatoRipasso.count({ where: { utenteId: alice.id } })).toBe(1);
    expect(read.stati).toEqual({ nuove: 0, apprendimento: 1, consolidate: 0 });
    expect(read.materie.find((m) => m.materia === 'DIRITTO_CIVILE')).toMatchObject({ nuove: 0, apprendimento: 1, consolidate: 0 });
    expect(read.prossimi.reduce((n, d) => n + d.schede, 0)).toBe(1);
  });

  it('the read by institute answers without it', async () => {
    const { kept, gone } = await twoReviewed();
    held = async () => {
      await prisma.lingoCard.deleteMany({ where: { id: gone.id } });
    };
    const { readPercorso } = await reads();
    expect(await readPercorso(alice.id)).toEqual([
      { materia: 'DIRITTO_CIVILE', istituto: kept.istituto, nuove: 0, apprendimento: 1, consolidate: 0, dovute: 0 },
    ]);
    expect(holds).toBe(1);
  });

  it('the review session answers without it', async () => {
    const { kept, gone } = await twoReviewed(TODAY);
    held = async () => {
      await prisma.lingoCard.deleteMany({ where: { id: gone.id } });
    };
    const { srs } = await reads();
    const response = await request(srs).get('/sessione').set(session(alice));
    expect(response.status).toBe(200);
    expect(holds).toBe(1);
    expect(response.body.cards.map((c: { id: string; nuova: boolean }) => [c.id, c.nuova])).toEqual([[kept.id, false]]);
  });

  it('the progress read answers when the whole account goes', async () => {
    await twoReviewed();
    held = async () => {
      await deleteUserAccount(alice.id);
    };
    const { readProgress } = await reads();
    const read = await readProgress(alice.id);
    expect(holds).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();
    expect(read.stati).toEqual({ nuove: 0, apprendimento: 0, consolidate: 0 });
  });
});
