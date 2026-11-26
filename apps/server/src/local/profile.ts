import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { createWebSession, revokeUserWebSessions } from '../auth/webSession';
import { hashPassword } from '../utils/password';

/**
 * The local profile (G-514, spec §6): the one user of the desktop app, made at first launch, with no usable password
 * (the hash of 32 random bytes nobody keeps). Its id is kept in `_lexcraft_meta`, the local file's own table.
 */
export const LOCAL_PROFILE = { email: 'profilo-locale@lexcraft.invalid', username: 'profilo-locale' } as const;

export async function ensureLocalProfile(): Promise<{ id: string }> {
  const kept = await prisma.$queryRaw<Array<{ value: string }>>`SELECT "value" FROM "_lexcraft_meta" WHERE "key" = 'local_user_id'`;
  if (kept.length === 1) {
    const user = await prisma.user.findUnique({ where: { id: kept[0].value }, select: { id: true } });
    if (user) return user;
  }
  const password = await hashPassword(randomBytes(32).toString('hex'));
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: LOCAL_PROFILE.email },
      update: {},
      create: { ...LOCAL_PROFILE, password, isVerified: true },
      select: { id: true },
    });
    await tx.$executeRaw`INSERT OR REPLACE INTO "_lexcraft_meta" ("key", "value") VALUES ('local_user_id', ${user.id})`;
    return user;
  });
}

/**
 * The window's session for this launch: every earlier session of the profile ends (a cookie a window kept from an
 * earlier launch opens nothing), and a new one is made.
 */
export async function openWindowSession(userId: string, userAgent: string | undefined): Promise<string> {
  await revokeUserWebSessions(userId);
  return createWebSession(userId, userAgent);
}
