import type { MerltConsentLevel, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/**
 * What MERL-T may collect from a person right now. The stored level counts only when it was
 * chosen under the current version of the MERL-T notice (`INFORMATIVA_MERLT`, a versioned text
 * like Studia's, decision 22): a level from before the notice existed, or under an older
 * version, collects nothing until the person answers the current one. Every guard and every
 * route that reads the level reads it here, never `merltUserPreference.consentLevel` directly.
 */
export interface EffectiveConsent {
  consentLevel: MerltConsentLevel;
  contributionEnabled: boolean;
  validationEnabled: boolean;
  graphEnabled: boolean;
  /** Whether the person has answered the current notice (with any level, `none` included). */
  noticeAnswered: boolean;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** The id of the current notice: its highest version. The migrations write version 1. */
export async function currentNoticeId(db: Db = prisma): Promise<string | null> {
  const row = await db.lingoTestoVersione.findFirst({
    where: { chiave: 'INFORMATIVA_MERLT' },
    orderBy: { versione: 'desc' },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function effectiveConsent(userId: string, db: Db = prisma): Promise<EffectiveConsent> {
  const [preference, noticeId] = await Promise.all([
    db.merltUserPreference.findUnique({
      where: { userId },
      select: {
        consentLevel: true,
        contributionEnabled: true,
        validationEnabled: true,
        graphEnabled: true,
        informativaTestoId: true,
      },
    }),
    currentNoticeId(db),
  ]);
  const noticeAnswered = !!preference && noticeId !== null && preference.informativaTestoId === noticeId;
  if (!preference || !noticeAnswered) {
    return {
      consentLevel: 'none',
      contributionEnabled: false,
      validationEnabled: false,
      graphEnabled: false,
      noticeAnswered,
    };
  }
  return {
    consentLevel: preference.consentLevel,
    contributionEnabled: preference.contributionEnabled,
    validationEnabled: preference.validationEnabled,
    graphEnabled: preference.graphEnabled,
    noticeAnswered,
  };
}
