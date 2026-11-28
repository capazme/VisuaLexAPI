import { LingoMateria, type Prisma } from '../lib/db';
import { z } from 'zod';
import { isSwitchOn } from '../assistant/switches';
import { AppError } from '../middleware/errorHandler';
import { personalScores } from './votes';
import type { AuthorProfile, Authors } from './views';

/**
 * The Forum's minimal profile (spec 2026-11-14-forum-community-server-design §B; D-246, D-247, D-249, G-477,
 * G-479): under the real name or under a pseudonym, never both; a declared qualification; the subjects the
 * person follows. A glossa is signed with the real name; a pseudonym is enough to discuss.
 */
export const QUALIFICATIONS = ['avvocato', 'praticante', 'magistrato', 'notaio', 'docente', 'dottore', 'studente', 'altro'] as const;

/** Reserved pseudonyms (compared without regard to case): a view's own words, the roles, the products. */
const RESERVED = new Set(['utente_cancellato', 'utente.cancellato', 'utente-cancellato', 'nome_ritirato', 'nome.ritirato',
  'moderatore', 'moderatori', 'amministratore', 'amministratori', 'admin', 'visualex', 'lexcraft', 'omnilex', 'librelex',
  'lingolex', 'merlt', 'merl-t', 'merl_t']);

export const MESSAGES = {
  sign: { text: 'Per firmare una glossa serve il profilo con il nome vero', code: 'real_name_required' },
  write: { text: 'Per scrivere nel Forum completa il profilo: nome o pseudonimo e qualifica', code: 'profile_required' },
  withdrawn: { text: 'Il nome del tuo profilo è stato ritirato dai responsabili del Forum', code: 'name_withdrawn' },
  taken: 'Questo pseudonimo è già usato',
  reserved: 'Questo pseudonimo è riservato',
  otherName: 'Hai contributi pubblicati con un altro nome: cancellali prima di usare uno pseudonimo',
  ownUsername: 'Lo pseudonimo non può essere il tuo nome utente: lo mostrano i dossier che pubblichi',
  notFound: 'Profilo non trovato',
} as const;

// Latin letters only (accents included), so no name passes for another with a lookalike letter of another
// alphabet (a Cyrillic «а» for an «a»). Measured in characters, as the database's CHECKs measure them: a
// string's `length` counts UTF-16 units.
const REAL_NAME = /^\p{Script=Latin}[\p{Script=Latin}\p{M} '’.-]*$/u;
const PSEUDONYM = /^[\p{Script=Latin}\p{M}0-9._-]+$/u;
const characters = (min: number, max: number) => (value: string) => {
  const count = [...value].length;
  return count >= min && count <= max;
};

const qualificationSchema = z.enum(QUALIFICATIONS, { message: 'La qualifica non è valida' });
// Learn's five subjects (the enum the glosse's `materia` uses).
const materiaSchema = z.enum(LingoMateria, { message: 'La materia non è valida' });
const materieSchema = z.array(materiaSchema, { message: 'Le materie non sono valide' }).max(5, 'Le materie non sono valide').default([])
  .transform((list) => [...new Set(list)]);

export const profileSchema = z.discriminatedUnion('identity', [
  z.object({
    identity: z.literal('real_name'),
    realName: z.string({ message: 'Il nome è obbligatorio' }).trim().normalize('NFC')
      .refine(characters(3, 80), 'Il nome deve avere da 3 a 80 caratteri')
      .refine((value) => REAL_NAME.test(value), 'Il nome può contenere solo lettere, spazi, apostrofi, trattini e punti'),
    qualification: qualificationSchema,
    materie: materieSchema,
  }),
  z.object({
    identity: z.literal('pseudonym'),
    pseudonym: z.string({ message: 'Lo pseudonimo è obbligatorio' }).trim().normalize('NFC')
      .refine(characters(3, 30), 'Lo pseudonimo deve avere da 3 a 30 caratteri')
      .refine((value) => PSEUDONYM.test(value), 'Lo pseudonimo può contenere solo lettere, cifre, punti, trattini e trattini bassi'),
    qualification: qualificationSchema,
    materie: materieSchema,
  }),
], { message: 'Scegli il nome vero o uno pseudonimo' });

export type ProfileInput = z.infer<typeof profileSchema>;

export function isReservedPseudonym(pseudonym: string) {
  return RESERVED.has(pseudonym.toLowerCase());
}

const AUTHOR_PROFILE = {
  id: true, userId: true, identity: true, realName: true, pseudonym: true, qualification: true, nameWithdrawnAt: true,
} as const;

/**
 * A page's authors, by account id: their personal scores and their Forum profiles, two queries for the
 * scores and one for the profiles, whatever the number of authors.
 */
export async function readAuthors(
  db: Pick<Prisma.TransactionClient, 'articleThread' | 'articleComment' | 'forumProfile'>,
  authorIds: (string | null)[],
): Promise<Authors> {
  const ids = [...new Set(authorIds.filter((id): id is string => id !== null))];
  const [scores, profiles] = await Promise.all([
    personalScores(db, ids),
    ids.length ? db.forumProfile.findMany({ where: { userId: { in: ids } }, select: AUTHOR_PROFILE }) : Promise.resolve([]),
  ]);
  return { scores, profiles: new Map<string, AuthorProfile>(profiles.map(({ userId, ...profile }) => [userId, profile])) };
}

type WriterDb = Pick<Prisma.TransactionClient, 'forumProfile' | 'appSwitch' | '$queryRaw'>;

/**
 * Whether a person may write now (§B), inside the write's transaction, after its locks on the glossa and the
 * reply: the person's account row is held for share, so a change of profile (which holds it for update)
 * never lands between this check and the write. A withdrawn name writes nothing; a pseudonym never signs a
 * glossa; with the switch `forum_identity` on, a glossa needs the real name and a reply any profile.
 */
export async function requireWriter(db: WriterDb, userId: string, act: 'glossa' | 'reply' | 'edit') {
  await db.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR SHARE`;
  const profile = await db.forumProfile.findUnique({ where: { userId }, select: { identity: true, nameWithdrawnAt: true } });
  if (profile?.nameWithdrawnAt) throw new AppError(403, MESSAGES.withdrawn.text, MESSAGES.withdrawn.code);
  if (act === 'edit') return;
  if (act === 'glossa' && profile?.identity === 'pseudonym') throw new AppError(403, MESSAGES.sign.text, MESSAGES.sign.code);
  if (!(await isSwitchOn('forum_identity', db))) return;
  if (act === 'glossa' && profile?.identity !== 'real_name') throw new AppError(403, MESSAGES.sign.text, MESSAGES.sign.code);
  if (!profile) throw new AppError(403, MESSAGES.write.text, MESSAGES.write.code);
}
