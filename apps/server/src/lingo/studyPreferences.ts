import type { LingoPreferenzeStudio, Prisma } from '@prisma/client';
import { DEFAULT_NUOVE_AL_GIORNO } from './reviewQueue';

/** The reviews that make a day count until the user changes it (Studia progress spec D7). */
export const DEFAULT_RIPASSI_AL_GIORNO = 10;

export type StudyPreferences = Pick<LingoPreferenzeStudio, 'nuoveAlGiorno' | 'ripassiAlGiorno' | 'materieComunita'>;

/** The preferences as the routes answer them: the defaults when the user never saved any. */
export function answerPreferences(row: StudyPreferences | null): StudyPreferences {
  return {
    nuoveAlGiorno: row?.nuoveAlGiorno ?? DEFAULT_NUOVE_AL_GIORNO,
    ripassiAlGiorno: row?.ripassiAlGiorno ?? DEFAULT_RIPASSI_AL_GIORNO,
    materieComunita: row?.materieComunita ?? [],
  };
}

/** Reads them without creating the row. */
export async function readPreferences(db: Prisma.TransactionClient, userId: string): Promise<StudyPreferences> {
  return answerPreferences(await db.lingoPreferenzeStudio.findUnique({ where: { utenteId: userId } }));
}
