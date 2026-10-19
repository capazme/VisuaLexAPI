import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { inDecisionKeySpace, readDecisionKey } from '../norms/decisionKey';
import { shortDecision } from '../norms/decisionCitation';

const anchorSchema = z.object({
  normaKey: z.string({ message: 'La norma o la decisione è obbligatoria' }).min(1, 'La norma o la decisione è obbligatoria')
    .max(500, 'La chiave della norma non è valida'),
  // '' only for a decision (checked in `checkAnchor`)
  articleId: z.string({ message: 'L’articolo non è valido' }).max(120, 'L’articolo non è valido'),
  articleLabel: z.string({ message: 'L’etichetta non è valida' }).max(300, 'L’etichetta non è valida').optional(),
  version: z.string({ message: 'La versione non è valida' }).max(120, 'La versione non è valida').optional(),
});

const INVALID_DECISION_KEY = 'La chiave della decisione non è valida';

/**
 * The target is derived from the key, never trusted: a key in the decision key space is a decision
 * and must read back; anything else is an article's, which needs an article id.
 */
function checkAnchor(anchor: { normaKey: string; articleId: string; version?: string; articleUrn?: string }) {
  if (inDecisionKeySpace(anchor.normaKey)) {
    if (!readDecisionKey(anchor.normaKey)) throw new AppError(400, INVALID_DECISION_KEY);
    if (anchor.articleId !== '') throw new AppError(400, 'Una glossa su una decisione non ha un articolo');
    if (anchor.version !== undefined) throw new AppError(400, 'Una glossa su una decisione non ha una versione');
    if (anchor.articleUrn !== undefined) throw new AppError(400, 'Una glossa su una decisione non ha un URN');
    return 'decision' as const;
  }
  if (anchor.articleId.length < 1) throw new AppError(400, 'L’articolo è obbligatorio');
  return 'article' as const;
}

// Optional and redundant with normaKey: accepted only when it agrees with it.
const targetSchema = z.object({
  kind: z.enum(['article', 'decision'], { message: 'La destinazione deve essere «article» o «decision»' }),
  key: z.string({ message: 'La chiave della destinazione non è valida' }).max(500, 'La chiave della destinazione non è valida').optional(),
}, { message: 'La destinazione non è valida' }).optional();

const moderationSchema = z.object({
  hidden: z.boolean({ message: '«hidden» deve essere vero o falso' }).optional(),
  passageReleased: z.boolean({ message: '«passageReleased» deve essere vero o falso' }).optional(),
}, { message: 'La richiesta non è valida' })
  .refine((b) => b.hidden !== undefined || b.passageReleased !== undefined, 'Nessuna modifica richiesta');

/** Parses with Zod but answers with the first message alone, in Italian: the global handler's English prefix is not for these routes. */
function parseItalian<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, result.error.issues[0].message);
  return result.data;
}

const passageSchema = z.object({
  quote: z.string({ message: 'La citazione non è valida' }).min(1, 'La citazione non può essere vuota')
    .max(2000, 'La citazione può avere al massimo 2000 caratteri')
    .refine((s) => s.trim().length > 0, 'La citazione non può essere vuota'),
  start: z.number({ message: 'La posizione del passo non è valida' }).int('La posizione del passo non è valida')
    .min(0, 'La posizione del passo non è valida').max(2_000_000, 'La posizione del passo non è valida'),
  prefix: z.string({ message: 'Il contesto del passo non è valido' }).max(32, 'Il contesto del passo non è valido'),
  suffix: z.string({ message: 'Il contesto del passo non è valido' }).max(32, 'Il contesto del passo non è valido'),
}, { message: 'Il passo citato non è valido' });

const createThreadSchema = anchorSchema.extend({
  title: z.string({ message: 'Il titolo non è valido' }).trim().max(200, 'Il titolo può avere al massimo 200 caratteri').optional(),
  body: z.string({ message: 'Il testo è obbligatorio' }).trim().min(3, 'Il testo deve avere almeno 3 caratteri')
    .max(10000, 'Il testo può avere al massimo 10000 caratteri'),
  passage: passageSchema.optional(),
  articleUrn: z.string({ message: 'L’URN non è valido' }).trim().min(1, 'L’URN non è valido').max(1000, 'L’URN non è valido').optional(),
  textHash: z.string().regex(/^[0-9a-f]{64}$/, 'Impronta del testo non valida').optional(),
}).superRefine((data, ctx) => {
  const title = data.title ?? '';
  if (!data.passage && title.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'],
      message: 'Il titolo è obbligatorio (almeno 3 caratteri) per una glossa senza un passo citato' });
  }
  if (data.passage && title.length > 0 && title.length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'],
      message: 'Il titolo, se indicato, deve avere almeno 3 caratteri' });
  }
});

const createCommentSchema = z.object({
  body: z.string({ message: 'Il testo è obbligatorio' }).trim().min(1, 'Il testo è obbligatorio')
    .max(10000, 'Il testo può avere al massimo 10000 caratteri'),
  parentId: z.string().uuid('La risposta non è valida').optional().nullable(),
});

const reportSchema = z.object({
  reason: z.string({ message: 'Il motivo è obbligatorio' }).trim().min(2, 'Il motivo è obbligatorio')
    .max(80, 'Il motivo può avere al massimo 80 caratteri'),
  details: z.string({ message: 'I dettagli non sono validi' }).trim().max(1000, 'I dettagli possono avere al massimo 1000 caratteri').optional(),
});

function userView(user: { id: string; username: string }) {
  return { id: user.id, username: user.username };
}

function commentView(comment: {
  id: string; threadId: string; parentId: string | null; body: string; userId: string;
  isHidden: boolean; createdAt: Date; updatedAt: Date; user: { id: string; username: string };
  votes: { userId: string }[];
}, userId: string) {
  return {
    id: comment.id,
    threadId: comment.threadId,
    parentId: comment.parentId,
    body: comment.isHidden ? '[Contenuto rimosso]' : comment.body,
    isHidden: comment.isHidden,
    user: userView(comment.user),
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    voteCount: comment.votes.length,
    userVoted: comment.votes.some(vote => vote.userId === userId),
    isOwner: comment.userId === userId,
  };
}

function threadView(thread: {
  id: string;
  normaKey: string;
  articleId: string;
  articleLabel: string | null;
  version: string | null;
  passageQuote: string | null;
  passageStart: number | null;
  passagePrefix: string | null;
  passageSuffix: string | null;
  articleUrn: string | null;
  textHash: string | null;
  targetKind: string;
  decisionKey: string | null;
  passageReleasedAt: Date | null;
  title: string;
  body: string;
  user: { id: string; username: string };
  createdAt: Date;
  updatedAt: Date;
  votes: { userId: string }[];
  comments: Parameters<typeof commentView>[0][];
  userId?: string;
}, userId: string) {
  return {
    id: thread.id,
    normaKey: thread.normaKey,
    articleId: thread.articleId,
    articleLabel: thread.articleLabel,
    version: thread.version,
    target: thread.targetKind === 'decision' && thread.decisionKey
      ? { kind: 'decision' as const, key: thread.decisionKey }
      : { kind: 'article' as const },
    passageReleased: thread.passageReleasedAt !== null,
    title: thread.title,
    body: thread.body,
    passage: thread.passageQuote === null || thread.passageStart === null
      ? null
      : {
          quote: thread.passageQuote,
          start: thread.passageStart,
          prefix: thread.passagePrefix ?? '',
          suffix: thread.passageSuffix ?? '',
        },
    articleUrn: thread.articleUrn,
    textHash: thread.textHash,
    user: userView(thread.user),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    voteCount: thread.votes.length,
    userVoted: thread.votes.some(vote => vote.userId === userId),
    isOwner: (thread.userId ?? thread.user.id) === userId,
    comments: thread.comments.map(comment => commentView(comment, userId)),
  };
}

const pagingSchema = z.object({
  page: z.coerce.number({ message: 'La pagina non è valida' }).int('La pagina non è valida').min(1, 'La pagina non è valida')
    .max(10_000, 'La pagina non è valida').default(1),
  limit: z.coerce.number({ message: 'Il numero di risultati non è valido' }).int('Il numero di risultati non è valido')
    .min(1, 'Il numero di risultati non è valido').max(50, 'Al massimo 50 risultati per pagina').default(20),
});

/** `page` and `limit` of a list query; a value that is not a number is a 400, not a database error. */
function parsePaging(query: Request['query']) {
  return parseItalian(pagingSchema, { page: query.page, limit: query.limit });
}

/** The list queries: a decision's articleId is '' and may be left out. */
function parseListAnchor(query: unknown) {
  const { normaKey, articleId } = parseItalian(
    anchorSchema.pick({ normaKey: true }).extend({ articleId: z.string({ message: 'L’articolo non è valido' }).max(120, 'L’articolo non è valido').optional() }),
    query,
  );
  const anchor = { normaKey, articleId: articleId ?? '' };
  if (articleId === undefined && !inDecisionKeySpace(normaKey)) throw new AppError(400, 'L’articolo è obbligatorio');
  checkAnchor(anchor);
  return anchor;
}

export const listThreads = async (req: Request, res: Response) => {
  const { normaKey, articleId } = parseListAnchor(req.query);
  const sort = req.query.sort === 'popular' ? 'popular' : req.query.sort === 'active' ? 'active' : 'recent';
  const { page, limit } = parsePaging(req.query);

  const where = { normaKey, articleId, isHidden: false };
  const [total, threads] = await Promise.all([
    prisma.articleThread.count({ where }),
    prisma.articleThread.findMany({
      where,
      include: {
        user: { select: { id: true, username: true } },
        comments: {
          where: { isHidden: false },
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, username: true } }, votes: true },
        },
        votes: true,
      },
      orderBy: sort === 'popular'
        ? { votes: { _count: 'desc' } }
        : sort === 'active'
          ? { updatedAt: 'desc' }
          : { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: threads.map(thread => threadView(thread, req.user!.id)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

export const listPassages = async (req: Request, res: Response) => {
  const { normaKey, articleId } = parseListAnchor(req.query);

  const threads = await prisma.articleThread.findMany({
    where: {
      normaKey,
      articleId,
      isHidden: false,
      passageQuote: { not: null },
    },
    select: {
      id: true,
      title: true,
      passageQuote: true,
      passageStart: true,
      passagePrefix: true,
      passageSuffix: true,
      articleUrn: true,
      textHash: true,
      createdAt: true,
      user: { select: { id: true, username: true } },
      _count: { select: { comments: { where: { isHidden: false } } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  res.json({
    data: threads.map(thread => ({
      id: thread.id,
      title: thread.title,
      passage: {
        quote: thread.passageQuote!,
        start: thread.passageStart!,
        prefix: thread.passagePrefix ?? '',
        suffix: thread.passageSuffix ?? '',
      },
      articleUrn: thread.articleUrn,
      textHash: thread.textHash,
      commentCount: thread._count.comments,
      createdAt: thread.createdAt,
      user: userView(thread.user),
    })),
  });
};

// The Forum's feed of glosse (spec 2026-10-19-glosse-forum): every visible thread, of every
// article and decision, without the comments' bodies. It shows no more than the per-article list.
const FEED_SORTS = ['recent', 'popular', 'active', 'unanswered'] as const;

// The decision key space (`norms/decisionKey.ts`), then up to two more segments: the archive, or a
// TAR's seat and kind. No number or year: the filter names a court, `normaKey` names one decision.
const COURT_PREFIX = /^(?:cassazione|corte_costituzionale|corte_giustizia_ue|tribunale_ue|consiglio_di_stato|cgars|tar)(?::[a-z-]{1,20}){0,2}$/;

/** A LIKE prefix as Prisma sends it: `_` is a wildcard there, so it is escaped. */
const likePrefix = (prefix: string) => prefix.replace(/_/g, '\\_');

const feedSchema = z.object({
  sort: z.enum(FEED_SORTS, { message: 'L’ordinamento deve essere «recent», «popular», «active» o «unanswered»' }).default('recent'),
  kind: z.enum(['article', 'decision'], { message: 'Il tipo deve essere «article» o «decision»' }).optional(),
  // An act's key (the web's `buildNormaKey`): the glosse on any of its articles.
  act: z.string({ message: 'L’atto non è valido' }).regex(/^[a-z0-9_-]{1,300}$/, 'L’atto non è valido').optional(),
  // One article's key (the web's `buildItemKey`) or one decision's key.
  normaKey: z.string({ message: 'La chiave non è valida' }).min(1, 'La chiave non è valida').max(500, 'La chiave non è valida').optional(),
  // A court, or a court's segment, as a decision key begins: «cassazione», «cassazione:penale», «tar:roma».
  court: z.string({ message: 'La corte non è valida' }).regex(COURT_PREFIX, 'La corte non è valida').optional(),
  // «le mie glosse»: the reader's own, never another user's.
  mine: z.enum(['true', 'false'], { message: '«mine» deve essere «true» o «false»' }).optional(),
}).superRefine((q, ctx) => {
  if (q.act !== undefined && q.normaKey !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica l’atto o la chiave, non entrambi' });
  }
  if (q.act !== undefined && q.kind === 'decision') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un atto ha glosse sugli articoli, non sulle decisioni' });
  }
  if (q.court !== undefined && (q.act !== undefined || q.normaKey !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica la corte, l’atto o la chiave: uno solo' });
  }
  if (q.court !== undefined && q.kind === 'article') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Una corte ha glosse sulle decisioni, non sugli articoli' });
  }
});

const FEED_EXCERPT = 280;

/** The first words of a body, for a list; the whole body is on the glossa's own route. */
function excerpt(body: string): string {
  if (body.length <= FEED_EXCERPT) return body;
  const cut = body.slice(0, FEED_EXCERPT);
  const space = cut.lastIndexOf(' ');
  return `${(space > FEED_EXCERPT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** «Cass. civ., n. 31310/2024»: a decision named from its key; null for an article's thread. */
function decisionLabel(thread: { targetKind: string; decisionKey: string | null }): string | null {
  if (thread.targetKind !== 'decision' || !thread.decisionKey) return null;
  const identity = readDecisionKey(thread.decisionKey);
  return identity ? shortDecision(identity) : null;
}

/**
 * The quotation as a view away from the text shows it. A decision's quotation may be words the
 * court has since withdrawn; the reader's panel decides that against the text it holds and fails
 * closed (apps/web/CLAUDE.md, «Passage discussions»). A list holds no text, so a decision's
 * quotation is withheld here unless an admin released it, or the reader wrote it or is an admin.
 */
function feedPassage(
  thread: { targetKind: string; passageQuote: string | null; passageReleasedAt: Date | null; userId: string },
  viewer: { id: string; isAdmin: boolean },
) {
  if (thread.passageQuote === null) return null;
  const withheld = thread.targetKind === 'decision' && thread.passageReleasedAt === null
    && thread.userId !== viewer.id && !viewer.isAdmin;
  return { quote: withheld ? null : thread.passageQuote, withheld };
}

const feedSelect = (viewerId: string) => ({
  id: true,
  normaKey: true,
  articleId: true,
  articleLabel: true,
  version: true,
  articleUrn: true,
  targetKind: true,
  decisionKey: true,
  passageQuote: true,
  passageReleasedAt: true,
  title: true,
  body: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, username: true } },
  votes: { where: { userId: viewerId }, select: { id: true } },
  _count: { select: { votes: true, comments: { where: { isHidden: false } } } },
}) satisfies Prisma.ArticleThreadSelect;

type FeedRow = Prisma.ArticleThreadGetPayload<{ select: ReturnType<typeof feedSelect> }>;

function feedItemView(thread: FeedRow, viewer: { id: string; isAdmin: boolean }) {
  return {
    id: thread.id,
    title: thread.title,
    excerpt: excerpt(thread.body),
    normaKey: thread.normaKey,
    articleId: thread.articleId,
    articleLabel: thread.articleLabel,
    version: thread.version,
    articleUrn: thread.articleUrn,
    target: thread.targetKind === 'decision' && thread.decisionKey
      ? { kind: 'decision' as const, key: thread.decisionKey }
      : { kind: 'article' as const },
    decisionLabel: decisionLabel(thread),
    passage: feedPassage(thread, viewer),
    user: userView(thread.user),
    voteCount: thread._count.votes,
    userVoted: thread.votes.length > 0,
    commentCount: thread._count.comments,
    createdAt: thread.createdAt,
    // a reply sets it (`createComment`); moderation keeps it (`moderateThread`)
    lastActivityAt: thread.updatedAt,
    isOwner: thread.userId === viewer.id,
  };
}

export const listFeed = async (req: Request, res: Response) => {
  const query = parseItalian(feedSchema, req.query);
  const { page, limit } = parsePaging(req.query);
  const viewer = { id: req.user!.id, isAdmin: Boolean(req.user!.isAdmin) };

  const where: Prisma.ArticleThreadWhereInput = {
    isHidden: false,
    ...(query.kind ? { targetKind: query.kind } : {}),
    // the act's key and then «--»: «legge--241--…» is not an article of «legge--24». The key's
    // segments are not typed, so an act named without its date also reads the dated acts of
    // that number (the web always sends the date it has).
    ...(query.act ? { targetKind: 'article', normaKey: { startsWith: `${likePrefix(query.act)}--` } } : {}),
    // the court's prefix and then «:», as for an act: «tar:rom» is not «tar:roma».
    ...(query.court ? { targetKind: 'decision', decisionKey: { startsWith: `${likePrefix(query.court)}:` } } : {}),
    ...(query.normaKey ? { normaKey: query.normaKey } : {}),
    ...(query.mine === 'true' ? { userId: viewer.id } : {}),
    ...(query.sort === 'unanswered' ? { comments: { none: { isHidden: false } } } : {}),
  };
  const orderBy: Prisma.ArticleThreadOrderByWithRelationInput[] = query.sort === 'popular'
    ? [{ votes: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]
    : query.sort === 'active'
      ? [{ updatedAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  const [total, threads] = await Promise.all([
    prisma.articleThread.count({ where }),
    prisma.articleThread.findMany({
      where,
      select: feedSelect(viewer.id),
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    data: threads.map(thread => feedItemView(thread, viewer)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

/** One glossa with its replies, for its page in the Forum: the feed's fields plus the thread's own. */
export const getThread = async (req: Request, res: Response) => {
  const viewer = { id: req.user!.id, isAdmin: Boolean(req.user!.isAdmin) };
  const thread = await prisma.articleThread.findUnique({
    where: { id: req.params.threadId },
    include: {
      user: { select: { id: true, username: true } },
      comments: {
        where: { isHidden: false },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, username: true } }, votes: true },
      },
      votes: true,
    },
  });
  if (!thread || thread.isHidden) throw new AppError(404, 'Glossa non trovata');
  const view = threadView(thread, viewer.id);
  const passage = feedPassage(thread, viewer);
  res.json({
    ...view,
    // the context around the words could hold what was withdrawn: the passage goes whole
    passage: passage?.withheld ? null : view.passage,
    passageWithheld: passage?.withheld ?? false,
    decisionLabel: decisionLabel(thread),
    commentCount: thread.comments.length,
    lastActivityAt: thread.updatedAt,
  });
};

export const createThread = async (req: Request, res: Response) => {
  const data = parseItalian(createThreadSchema, req.body);
  const target = parseItalian(targetSchema, req.body?.target);
  const kind = checkAnchor(data);
  if (target) {
    if (kind === 'article' && target.key !== undefined) throw new AppError(400, 'Una destinazione articolo non ha una chiave');
    if (target.kind !== kind || (kind === 'decision' && target.key !== data.normaKey)) {
      throw new AppError(400, 'La destinazione non corrisponde alla chiave');
    }
  }
  const thread = await prisma.articleThread.create({
    data: {
      targetKind: kind,
      decisionKey: kind === 'decision' ? data.normaKey : null,
      normaKey: data.normaKey,
      articleId: data.articleId,
      articleLabel: data.articleLabel,
      version: data.version,
      title: data.title ?? '',
      body: data.body,
      passageQuote: data.passage?.quote ?? null,
      passageStart: data.passage?.start ?? null,
      passagePrefix: data.passage?.prefix ?? null,
      passageSuffix: data.passage?.suffix ?? null,
      articleUrn: data.articleUrn ?? null,
      textHash: data.textHash ?? null,
      userId: req.user!.id,
    },
    include: {
      user: { select: { id: true, username: true } },
      comments: {
        where: { isHidden: false },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, username: true } }, votes: true },
      },
      votes: true,
    },
  });
  res.status(201).json(threadView(thread, req.user!.id));
};

export const createComment = async (req: Request, res: Response) => {
  const data = parseItalian(createCommentSchema, req.body);
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread || thread.isHidden) throw new AppError(404, 'Glossa non trovata');

  if (data.parentId) {
    const parent = await prisma.articleComment.findFirst({ where: { id: data.parentId, threadId: thread.id } });
    if (!parent) throw new AppError(404, 'Risposta padre non trovata');
    let depth = 1;
    let currentParentId = parent.parentId;
    while (currentParentId && depth < 4) {
      const ancestor = await prisma.articleComment.findUnique({ where: { id: currentParentId }, select: { parentId: true } });
      currentParentId = ancestor?.parentId ?? null;
      depth += 1;
    }
    if (depth >= 3) throw new AppError(400, 'La profondità delle risposte è limitata a tre livelli');
  }

  const comment = await prisma.articleComment.create({
    data: { threadId: thread.id, parentId: data.parentId ?? null, body: data.body, userId: req.user!.id },
    include: { user: { select: { id: true, username: true } }, votes: true },
  });
  await prisma.articleThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  res.status(201).json(commentView(comment, req.user!.id));
};

export const toggleThreadVote = async (req: Request, res: Response) => {
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread || thread.isHidden) throw new AppError(404, 'Glossa non trovata');
  const existing = await prisma.articleThreadVote.findUnique({ where: { threadId_userId: { threadId: thread.id, userId: req.user!.id } } });
  if (existing) await prisma.articleThreadVote.delete({ where: { id: existing.id } });
  else await prisma.articleThreadVote.create({ data: { threadId: thread.id, userId: req.user!.id } });
  const voteCount = await prisma.articleThreadVote.count({ where: { threadId: thread.id } });
  res.json({ voted: !existing, voteCount });
};

export const toggleCommentVote = async (req: Request, res: Response) => {
  const comment = await prisma.articleComment.findUnique({ where: { id: req.params.commentId } });
  if (!comment || comment.isHidden) throw new AppError(404, 'Risposta non trovata');
  const existing = await prisma.articleCommentVote.findUnique({ where: { commentId_userId: { commentId: comment.id, userId: req.user!.id } } });
  if (existing) await prisma.articleCommentVote.delete({ where: { id: existing.id } });
  else await prisma.articleCommentVote.create({ data: { commentId: comment.id, userId: req.user!.id } });
  const voteCount = await prisma.articleCommentVote.count({ where: { commentId: comment.id } });
  res.json({ voted: !existing, voteCount });
};

export const reportThread = async (req: Request, res: Response) => {
  const data = parseItalian(reportSchema, req.body);
  const thread = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!thread) throw new AppError(404, 'Glossa non trovata');
  await prisma.articleThreadReport.upsert({
    where: { threadId_userId: { threadId: thread.id, userId: req.user!.id } },
    create: { threadId: thread.id, userId: req.user!.id, reason: data.reason, details: data.details },
    update: { reason: data.reason, details: data.details, status: 'pending' },
  });
  res.status(204).send();
};

export const moderateThread = async (req: Request, res: Response) => {
  const body = parseItalian(moderationSchema, req.body);
  const data: { isHidden?: boolean; passageReleasedAt?: Date | null; passageReleasedById?: string | null } = {};
  if (body.hidden !== undefined) data.isHidden = body.hidden;
  const existing = await prisma.articleThread.findUnique({ where: { id: req.params.threadId } });
  if (!existing) throw new AppError(404, 'Glossa non trovata');
  if (body.passageReleased !== undefined) {
    if (existing.targetKind !== 'decision' || existing.passageQuote === null) {
      throw new AppError(400, 'Solo il passo citato di una decisione può essere rimesso in chiaro');
    }
    data.passageReleasedAt = body.passageReleased ? new Date() : null;
    data.passageReleasedById = body.passageReleased ? req.user!.id : null;
  }
  // `updatedAt` is the thread's last activity (the feed's «active»): moderation is not activity.
  // Written only if no reply moved it since it was read, else read again, so a reply is never undone.
  let updatedAt = existing.updatedAt;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { count } = await prisma.articleThread.updateMany({ where: { id: existing.id, updatedAt }, data: { ...data, updatedAt } });
    if (count === 1) break;
    const current = await prisma.articleThread.findUnique({ where: { id: existing.id }, select: { updatedAt: true } });
    if (!current) throw new AppError(404, 'Glossa non trovata');
    if (attempt === 2) throw new AppError(409, 'La glossa è cambiata: riprova');
    updatedAt = current.updatedAt;
  }
  const thread = await prisma.articleThread.findUniqueOrThrow({ where: { id: existing.id } });
  res.json({ id: thread.id, isHidden: thread.isHidden, passageReleased: thread.passageReleasedAt !== null });
};
