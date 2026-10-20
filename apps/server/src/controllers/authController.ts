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
const ATTRIBUTION_KEYS = new Set(['originalauthor', 'originalauthorid']);
// A person's identity, in a file the user imported by hand (someone else's, possibly): it stays
// only when it is the user's own id, username or email. `user`, `owner`, `suggester` and
// `reporter` are the web's person objects ({ id, username }): an object never is, so it goes whole.
const IDENTITY_KEYS = new Set([
  'author', 'authorid', 'authorname', 'authorusername', 'authoremail', 'username', 'userid', 'useremail', 'email',
  'user', 'owner', 'ownerid', 'suggester', 'suggesterid', 'reporter', 'reporterid',
]);

type OwnIdentity = { id: string; username: string; email: string };

const isOwnIdentity = (value: unknown, own: OwnIdentity) =>
  typeof value === 'string' && (value === own.id || value === own.username || value.toLowerCase() === own.email.toLowerCase());

/**
 * An archived environment's content is the JSON the web posted or a file the user imported by
 * hand, whose rows could carry the web's `originalAuthor` ({ id, username }) or an
 * `originalAuthorId`, which become `fromAnotherUser`, and anyone's `authorId`, `username`,
 * `user_id`, `email` and the like (`IDENTITY_KEYS`, case and `_`/`-` folded), which go unless they
 * are the user's own. At any depth; nothing else in the blob changes.
 */
function withoutAuthors(value: unknown, own: OwnIdentity): unknown {
  if (Array.isArray(value)) return value.map((inner) => withoutAuthors(inner, own));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  let fromAnotherUser = false;
  for (const [key, inner] of Object.entries(value)) {
    const folded = foldKey(key);
    if (ATTRIBUTION_KEYS.has(folded)) {
      fromAnotherUser ||= inner !== null && inner !== undefined;
      continue;
    }
    if (IDENTITY_KEYS.has(folded) && !isOwnIdentity(inner, own)) continue;
    // Defined, not assigned: a `__proto__` key in the blob stays a key of the row.
    Object.defineProperty(out, key, { value: withoutAuthors(inner, own), enumerable: true, writable: true, configurable: true });
  }
  if (fromAnotherUser) out.fromAnotherUser = true;
  return out;
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
  const own: OwnIdentity = { id: userId, username: req.user!.username, email: req.user!.email };

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
      quickNorms: quickNorms.map(withoutOriginalAuthor),
      customAliases: customAliases.map(withoutOriginalAuthor),
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
