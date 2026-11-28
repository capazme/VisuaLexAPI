import { describe, it, expect, vi, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The dialect seam (spec §5): row and advisory locks behind src/lib/sqlDialect.ts, and the two Work statements
 * that SQLite could not take rewritten. The Work functions run here on the encrypted local file: src/lib/prisma
 * is replaced by the local client, as the desktop app's local mode builds it.
 */
const state = vi.hoisted(() => {
  process.env.LEXCRAFT_MODE = 'local';
  return { remove: (): void => undefined };
});
vi.mock('../../src/lib/prisma', async () => {
  const { newLocalDatabase } = await import('./client');
  const local = newLocalDatabase();
  state.remove = local.remove;
  return { prisma: local.prisma };
});

afterAll(async () => {
  const { prisma } = await import('../../src/lib/prisma');
  await prisma.$disconnect();
  state.remove();
  delete process.env.LEXCRAFT_MODE;
});

const SRC = path.resolve(__dirname, '../../src');
/** The files of the sections that stay online (Learn, the Forum, the account's removal of contributions). */
const ONLINE_ONLY = [/^lingo\//, /^routes\/lingo/, /^forum\//, /^controllers\/forum(Communities|Profile)Controller\.ts$/, /^account\/removeAllContributions\.ts$/];
// A lock clause written out, or built from a fragment (`FOR ${Prisma.raw(mode)}`, as Learn does).
const LOCKS = /\bFOR\s+(NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b|\bFOR\s+\$\{|pg_advisory/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('the dialect seam', () => {
  it('no raw statement under src/ names a row lock or an advisory lock outside sqlDialect.ts, but online-only files', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (rel === 'lib/sqlDialect.ts' || ONLINE_ONLY.some((re) => re.test(rel))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        if (LOCKS.test(code)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('gives Postgres its lock clauses and SQLite nothing', async () => {
    const { forUpdate, forNoKeyUpdate } = await import('../../src/lib/sqlDialect');
    expect(forUpdate().sql).toBe('');
    process.env.LEXCRAFT_MODE = 'online';
    try {
      expect(forUpdate().sql).toBe(' FOR UPDATE');
      expect(forUpdate('i').sql).toBe(' FOR UPDATE OF i');
      expect(forNoKeyUpdate().sql).toBe(' FOR NO KEY UPDATE');
      expect(() => forUpdate('i; DROP TABLE x')).toThrow(/not a table alias/);
    } finally {
      process.env.LEXCRAFT_MODE = 'local';
    }
  });
});

describe('Work on the encrypted local file', () => {
  it('utcNow gives each database its expression', async () => {
    const { utcNow } = await import('../../src/lib/sqlDialect');
    expect(utcNow().sql).toContain('strftime');
    process.env.LEXCRAFT_MODE = 'online';
    try {
      expect(utcNow().sql).toBe("(now() AT TIME ZONE 'UTC')");
    } finally {
      process.env.LEXCRAFT_MODE = 'local';
    }
  });

  it('reorderTasks puts the named tasks at 0, 1, 2 in that order', async () => {
    const { prisma } = await import('../../src/lib/prisma');
    const { reorderTasks } = await import('../../src/tasks/tasks');
    const user = await prisma.user.create({ data: { email: 'riordino@example.invalid', username: 'riordino', password: 'x' } });
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((title, position) => prisma.task.create({ data: { userId: user.id, title, position } })));
    await reorderTasks(user.id, [c.id, a.id, b.id]);
    const order = await prisma.task.findMany({ where: { userId: user.id }, orderBy: { position: 'asc' }, select: { title: true, position: true } });
    expect(order).toEqual([{ title: 'C', position: 0 }, { title: 'A', position: 1 }, { title: 'B', position: 2 }]);
  });

  it('an entry moved to the trash comes back with its content', async () => {
    const { prisma } = await import('../../src/lib/prisma');
    const { trashDossierItems, restoreTrashEntry, BY_THE_USER } = await import('../../src/trash/trash');
    const user = await prisma.user.create({ data: { email: 'cestino@example.invalid', username: 'cestino', password: 'x' } });
    const dossier = await prisma.dossier.create({ data: { name: 'Pratica', userId: user.id } });
    const content = { tipo_atto: 'codice civile', numero_articolo: '1453', nota: 'inventata' };
    const item = await prisma.dossierItem.create({ data: { dossierId: dossier.id, itemType: 'norm', title: 'art. 1453 c.c.', content } });
    const { trashId, moved } = await trashDossierItems(user.id, dossier.id, [item.id], BY_THE_USER);
    expect(moved).toEqual([item.id]);
    expect(await prisma.dossierItem.count({ where: { id: item.id } })).toBe(0);
    await restoreTrashEntry(user.id, trashId);
    const back = await prisma.dossierItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(back.content).toEqual(content);
  });
});
