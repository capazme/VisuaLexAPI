import { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken, verifyToken, verifyTokenType } from '../utils/jwt';
import { AppError } from '../middleware/errorHandler';
import { deleteUserAccount } from '../lingo/deleteUserAccount';
import { dateToDay } from '../lingo/studyDays';

// Password validation regex: min 8 chars, at least 1 uppercase, 1 lowercase, 1 number
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const passwordErrorMessage = 'Password must be at least 8 characters with 1 uppercase, 1 lowercase, and 1 number';

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50),
  password: z.string().min(8).regex(passwordRegex, passwordErrorMessage),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refresh_token: z.string(),
});

const changePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(8).regex(passwordRegex, passwordErrorMessage),
});

// Strict on purpose: an extra key (`devModeAllowed` above all) is refused, not stripped.
const setDevModeSchema = z.object({
  enabled: z.boolean(),
}).strict();

const deleteAccountSchema = z.object({
  password: z.string().min(1),
  confirmation: z.literal('ELIMINA ACCOUNT'),
});

// The account as the client reads it: /auth/me, the login and the development-mode switch all answer
// with this one shape.
const toMeResponse = (user: User) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  is_active: user.isActive,
  is_verified: user.isVerified,
  is_admin: user.isAdmin,
  lingo_validatore: user.lingoValidatore,
  dev_mode_allowed: user.devModeAllowed,
  dev_mode: user.devMode,
  created_at: user.createdAt,
  login_count: user.loginCount,
  last_login_at: user.lastLoginAt,
});

// Register - creates inactive user pending admin approval
export const register = async (req: Request, res: Response) => {
  const { email, username, password } = registerSchema.parse(req.body);

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });

  if (existingUser) {
    throw new AppError(400, 'User with this email or username already exists');
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user with isActive: false (requires admin approval)
  await prisma.user.create({
    data: {
      email,
      username,
      password: hashedPassword,
      isActive: false, // User must be approved by admin
    },
  });

  // Don't generate tokens - user cannot login until approved
  res.status(201).json({
    message: 'Registrazione completata. Il tuo account è in attesa di approvazione da parte di un amministratore.',
    pending_approval: true,
  });
};

// Login
export const login = async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new AppError(401, 'Invalid credentials');
  }

  // Verify password
  const isPasswordValid = await verifyPassword(password, user.password);

  if (!isPasswordValid) {
    throw new AppError(401, 'Invalid credentials');
  }

  if (!user.isActive) {
    throw new AppError(403, 'Il tuo account è in attesa di approvazione. Contatta un amministratore.');
  }

  // Update login stats
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      loginCount: { increment: 1 },
      lastLoginAt: new Date(),
    },
  });

  // Generate tokens
  const accessToken = generateAccessToken(updatedUser.id, updatedUser.email);
  const refreshToken = generateRefreshToken(updatedUser.id, updatedUser.email);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    user: toMeResponse(updatedUser),
  });
};

// Refresh token
export const refresh = async (req: Request, res: Response) => {
  const { refresh_token } = refreshSchema.parse(req.body);

  const payload = verifyToken(refresh_token);

  if (!payload || !verifyTokenType(payload, 'refresh')) {
    throw new AppError(401, 'Invalid refresh token');
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user || !user.isActive) {
    throw new AppError(401, 'User not found or inactive');
  }

  // Generate new tokens
  const accessToken = generateAccessToken(user.id, user.email);
  const refreshToken = generateRefreshToken(user.id, user.email);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
  });
};

// Get current user
export const getCurrentUser = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  res.json(toMeResponse(req.user));
};

// Turn the development mode on or off for the signed-in user
export const setDevMode = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { enabled } = setDevModeSchema.parse(req.body);

  // The permission is checked in the write itself: `req.user` was read before this point, and an
  // administrator may revoke the permission in between, which must not leave the mode on.
  const { count } = await prisma.user.updateMany({
    where: { id: req.user.id, ...(enabled && { devModeAllowed: true }) },
    data: { devMode: enabled },
  });

  if (count === 0) {
    throw new AppError(403, 'Modalità sviluppo non abilitata per questo account');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });

  res.json(toMeResponse(user));
};

// Change password
export const changePassword = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { current_password, new_password } = changePasswordSchema.parse(req.body);

  // Verify current password
  const isPasswordValid = await verifyPassword(current_password, req.user.password);

  if (!isPasswordValid) {
    throw new AppError(400, 'Current password is incorrect');
  }

  // Hash new password
  const hashedPassword = await hashPassword(new_password);

  // Update password
  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: hashedPassword },
  });

  res.json({ message: 'Password changed successfully' });
};

/** A row taken from someone else (a suggestion, a Forum download) says so, never whose it was. */
const withoutOriginalAuthor = <T extends { originalAuthorId: string | null }>({ originalAuthorId, ...row }: T) =>
  ({ ...row, fromAnotherUser: originalAuthorId !== null });

/** A key of an archived environment's content, folded: `Author_Id`, `author-id` and `authorId` are one key. */
const foldKey = (key: string) => key.toLowerCase().replace(/[_-]/g, '');
// The web's attribution of a row taken from someone else: it becomes `fromAnotherUser`.
const ATTRIBUTION_KEYS = new Set([
  'originalauthor', 'originalauthorid', 'originalauthorusername', 'originalauthorname', 'originalauthoremail',
]);
// A person's identity, in a file the user imported by hand (someone else's, possibly): it stays
// only when it is the user's own id, username or email. `user`, `owner`, `suggester` and
// `reporter` are the web's person objects ({ id, username }): an object never is, so it goes whole.
// A display or full name cannot be told from the user's own, so it always goes.
const IDENTITY_KEYS = new Set([
  'author', 'authorid', 'authorname', 'authorusername', 'authoremail', 'username', 'userid', 'useremail', 'email',
  'user', 'owner', 'ownerid', 'suggester', 'suggesterid', 'reporter', 'reporterid',
  'displayname', 'fullname', 'autoreid', 'utenteid',
]);
// Keys that only a person has: beside an id, they make the object a person (`personKind`).
const PERSON_KEYS = new Set(['username', 'email', 'displayname', 'fullname', 'firstname', 'lastname']);
// A name is also a dossier's or an environment's: it makes a person only of a user's own record.
const NAME_KEYS = new Set([...PERSON_KEYS, 'name']);
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `foreignUserIds`: the ids, lowercased, of the other users the content names (`foreignUserIdsIn`). */
type OwnIdentity = { id: string; username: string; email: string; foreignUserIds: ReadonlySet<string> };

const isOwnIdentity = (value: unknown, own: OwnIdentity) =>
  typeof value === 'string' && (value === own.id || value === own.username || value.toLowerCase() === own.email.toLowerCase());

/** A string that holds another user's id, alone or inside a longer text (a link, a `user:<id>`). */
const holdsForeignUserId = (value: unknown, own: OwnIdentity) =>
  typeof value === 'string' && (value.match(UUID_PATTERN) ?? []).some((id) => own.foreignUserIds.has(id.toLowerCase()));

/** `id`, `uid`, `userId`, `autore_id`: a key that names an id. */
const isIdKey = (folded: string) => folded === 'id' || folded.endsWith('id');

/**
 * What an object of the content is, as a person:
 * - `user`: a user's record, someone else's: its own `id` is another user's, beside a name,
 *   username or email. It goes whole: whatever else it holds is that person's.
 * - `person`: someone's identity on a row: an id beside a key only a person has (`PERSON_KEYS`),
 *   say `{ author_id, username }` or `{ id, displayName, text }`. Its ids and names go, whatever
 *   the keys are called, so no id is left behind under a key the lists do not know.
 * - `own`: either of the two, but the user's: their id, username or email, and no other user's id
 *   (a display name cannot be checked). Its names stay.
 */
function personKind(entries: [string, unknown][], own: OwnIdentity): 'none' | 'own' | 'user' | 'person' {
  const folded = entries.map(([key, inner]) => [foldKey(key), inner] as const);
  const ids = folded.filter(([key, inner]) => isIdKey(key) && typeof inner === 'string' && inner !== '');
  if (ids.length === 0) return 'none';
  const record = folded.find(([key]) => key === 'id' || key === 'uid')?.[1];
  const isUserRecord = typeof record === 'string' && (record === own.id || own.foreignUserIds.has(record.toLowerCase()))
    && folded.some(([key]) => NAME_KEYS.has(key));
  const isPerson = folded.some(([key]) => PERSON_KEYS.has(key));
  if (!isUserRecord && !isPerson) return 'none';
  // The user's, by something that can be checked: their id, username or email, and nobody else's.
  const checkable = folded.filter(([key]) => key === 'username' || key === 'email');
  const mine = folded.every(([, inner]) => !holdsForeignUserId(inner, own))
    && checkable.every(([, inner]) => isOwnIdentity(inner, own))
    && (checkable.length > 0 || ids.some(([, inner]) => inner === own.id));
  if (mine) return 'own';
  return isUserRecord ? 'user' : 'person';
}

const isOtherUser = (value: unknown, own: OwnIdentity) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && personKind(Object.entries(value), own) === 'user';

/**
 * An archived environment's content is the JSON the web posted or a file the user imported by
 * hand, whose rows could carry the web's `originalAuthor` ({ id, username }) or an
 * `originalAuthorId`, which become `fromAnotherUser`, and anyone's `authorId`, `username`,
 * `user_id`, `email` and the like (`IDENTITY_KEYS`, case and `_`/`-` folded), which go unless they
 * are the user's own. Someone else's person object loses its ids and names, or goes whole when it
 * is a user's record (`personKind`); a string that holds another user's id goes, under any key.
 * At any depth; nothing else in the blob changes.
 */
function withoutAuthors(value: unknown, own: OwnIdentity): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((inner) => !holdsForeignUserId(inner, own) && !isOtherUser(inner, own))
      .map((inner) => withoutAuthors(inner, own));
  }
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value);
  const kind = personKind(entries, own);
  const out: Record<string, unknown> = {};
  let fromAnotherUser = false;
  for (const [key, inner] of entries) {
    const folded = foldKey(key);
    if (ATTRIBUTION_KEYS.has(folded)) {
      fromAnotherUser ||= inner !== null && inner !== undefined;
      continue;
    }
    // The user's own record keeps its names (a display name cannot be checked); anything else is read as ever.
    if (IDENTITY_KEYS.has(folded) && !isOwnIdentity(inner, own) && !(kind === 'own' && NAME_KEYS.has(folded))) continue;
    // Someone else's record or identity: its ids and names go (a record at the top, which no
    // parent removes, keeps only what is not about the person).
    if ((kind === 'person' || kind === 'user') && (isIdKey(folded) || NAME_KEYS.has(folded))) continue;
    if (holdsForeignUserId(key, own) || holdsForeignUserId(inner, own) || isOtherUser(inner, own)) continue;
    // Defined, not assigned: a `__proto__` key in the blob stays a key of the row.
    Object.defineProperty(out, key, { value: withoutAuthors(inner, own), enumerable: true, writable: true, configurable: true });
  }
  if (fromAnotherUser) out.fromAnotherUser = true;
  return out;
}

/** Every id-shaped string in the content, lowercased: the candidates for a user's id. */
function collectUuids(value: unknown, into: Set<string>) {
  if (typeof value === 'string') {
    for (const id of value.match(UUID_PATTERN) ?? []) into.add(id.toLowerCase());
  } else if (Array.isArray(value)) {
    for (const inner of value) collectUuids(inner, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      collectUuids(key, into);
      collectUuids(inner, into);
    }
  }
}

/** The ids, among those the content holds, that belong to another user of this instance. */
async function foreignUserIdsIn(contents: unknown[], ownId: string): Promise<Set<string>> {
  const candidates = new Set<string>();
  for (const content of contents) collectUuids(content, candidates);
  candidates.delete(ownId.toLowerCase());
  const foreign = new Set<string>();
  const all = [...candidates];
  // Below Postgres' bind-parameter limit, whatever the size of the content.
  for (let i = 0; i < all.length; i += 5000) {
    const users = await prisma.user.findMany({ where: { id: { in: all.slice(i, i + 5000) } }, select: { id: true } });
    for (const { id } of users) foreign.add(id.toLowerCase());
  }
  return foreign;
}

/**
 * Export the user's portable data set. Passwords, tokens and operational
 * secrets are deliberately excluded; the payload is versioned so a future
 * importer can migrate it without guessing its shape.
 *
 * Only what the user wrote or what is about them: no other person's id, name
 * or text. Under the user's discussions, the replies of others travel as a
 * count; a row the user took from someone else says so, not from whom.
 */
export const exportAccountData = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [user, folders, bookmarks, annotations, highlights, dossiers, history, environments, quickNorms, customAliases, threads, comments, lingoCards, lingoValidazioni, lingoAccettazioni, lingoRipassi, lingoPreferenze, lingoGiornate, merltConsenso, merltConsensoStorico] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true, createdAt: true, updatedAt: true } }),
    prisma.folder.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.bookmark.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.annotation.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.highlight.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.dossier.findMany({ where: { userId }, include: { items: true, snapshots: true }, orderBy: { createdAt: 'asc' } }),
    prisma.searchHistory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.environment.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.quickNorm.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.customAlias.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    // The user's own replies are in `comments`; the others' are counted, never read.
    prisma.articleThread.findMany({
      where: { userId },
      include: { _count: { select: { comments: { where: { userId: { not: userId } } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.articleComment.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.lingoCard.findMany({ where: { autoreId: userId }, include: { ancore: true }, orderBy: { createdAt: 'asc' } }),
    prisma.lingoValidazioneCard.findMany({
      where: { utenteId: userId },
      select: { cardId: true, giudizio: true, motivazione: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.lingoAccettazioneTesto.findMany({
      where: { utenteId: userId },
      select: { acceptedAt: true, testo: { select: { chiave: true, versione: true } } },
      orderBy: { acceptedAt: 'asc' },
    }),
    prisma.lingoRevisioneSRS.findMany({
      where: { utenteId: userId },
      select: { cardId: true, dataRevisione: true, rating: true, scheduledDays: true, stability: true, difficulty: true, durataMs: true },
      orderBy: [{ dataRevisione: 'asc' }, { id: 'asc' }],
    }),
    prisma.lingoPreferenzeStudio.findUnique({ where: { utenteId: userId }, select: { nuoveAlGiorno: true, ripassiAlGiorno: true, materieComunita: true } }),
    prisma.lingoGiornataStudio.findMany({
      where: { utenteId: userId },
      select: { giorno: true, ripassi: true, nuove: true, sbagliate: true, codaFinita: true, valido: true },
      orderBy: { giorno: 'asc' },
    }),
    // The MERL-T consent and its history, with the notice version each choice was made under.
    // What MERL-T itself collected is downloaded from Impostazioni › Dati MERL-T (`GET /api/merlt/data/export`).
    prisma.merltUserPreference.findUnique({
      where: { userId },
      select: { consentLevel: true, createdAt: true, updatedAt: true, informativa: { select: { versione: true } } },
    }),
    prisma.merltConsentAudit.findMany({
      where: { userId },
      select: { previousLevel: true, nextLevel: true, source: true, reason: true, createdAt: true, informativa: { select: { versione: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  // A quick norm's or an alias's search, taken from a proposal, is the proposer's JSON too.
  const foreignUserIds = await foreignUserIdsIn([
    ...dossiers.flatMap((dossier) => [...dossier.items.map((item) => item.content), ...dossier.snapshots.map((snapshot) => snapshot.content)]),
    ...environments.map((env) => env.content),
    ...quickNorms.map((norm) => norm.searchParams),
    ...customAliases.map((alias) => alias.searchParams),
  ], userId);
  const own: OwnIdentity = { id: userId, username: req.user!.username, email: req.user!.email, foreignUserIds };

  res.json({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    user,
    data: {
      folders, bookmarks,
      annotations: annotations.map(withoutOriginalAuthor),
      highlights: highlights.map(withoutOriginalAuthor),
      // An entry's content comes from the client as it is (a dossier imported from a link keeps a
      // note entry whole), and a snapshot copies it: both are read as an archived environment's.
      dossiers: dossiers.map(({ items, snapshots, ...dossier }) => withoutOriginalAuthor({
        ...dossier,
        items: items.map((item) => ({ ...item, content: withoutAuthors(item.content, own) })),
        snapshots: snapshots.map((snapshot) => ({ ...snapshot, content: withoutAuthors(snapshot.content, own) })),
      })),
      history,
      // An environment downloaded from the Forum was saved with its publisher's username as `author`,
      // indistinguishable from a name typed by the user: only the user's own username travels.
      environments: environments.map((env) => ({
        ...env,
        author: env.author !== null && env.author === user?.username ? env.author : null,
        content: withoutAuthors(env.content, own),
      })),
      quickNorms: quickNorms.map((norm) => withoutOriginalAuthor({ ...norm, searchParams: withoutAuthors(norm.searchParams, own) })),
      customAliases: customAliases.map((alias) => withoutOriginalAuthor({ ...alias, searchParams: withoutAuthors(alias.searchParams, own) })),
      // The release time is the author's; the releasing admin's id is another person's identifier.
      threads: threads.map(({ passageReleasedById: _releasedBy, _count, ...thread }) => ({ ...thread, repliesFromOthers: _count.comments })),
      comments, lingoCards, lingoValidazioni,
      lingoAccettazioni: lingoAccettazioni.map(({ testo, acceptedAt }) => ({ chiave: testo.chiave, versione: testo.versione, acceptedAt })),
      // The review log (the scheduling state is derived from it and not exported), the daily goals, and the
      // stored study days ('YYYY-MM-DD', Rome days: a DATE travels as UTC midnight).
      lingoRipassi, lingoPreferenze,
      lingoGiornate: lingoGiornate.map(({ giorno, ...day }) => ({ giorno: dateToDay(giorno), ...day })),
      merltConsenso, merltConsensoStorico,
    },
  });
};

/**
 * Permanently delete the authenticated account after explicit confirmation.
 * Prisma relations are configured with cascading ownership deletes, with one
 * exception: the study cards the community has taken up stay, without their
 * author (see `deleteUserAccount`).
 */
export const deleteAccount = async (req: Request, res: Response) => {
  const { password, confirmation } = deleteAccountSchema.parse(req.body);
  if (confirmation !== 'ELIMINA ACCOUNT') {
    throw new AppError(400, 'Conferma non valida');
  }
  const user = req.user!;
  if (!(await verifyPassword(password, user.password))) {
    throw new AppError(400, 'La password non è corretta');
  }

  await deleteUserAccount(user.id);
  res.status(204).send();
};
