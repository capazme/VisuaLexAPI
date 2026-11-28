import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../lib/db';

/**
 * The sentence a validation refusal answers with, as `detail`: «Invalid request: field (message; message), …».
 * Grouped by field before it becomes prose. One value can break several rules at once — a short password fails
 * both the length check and the complexity regex — and naming the field once per violation reads as
 * "password (...), password (...)". Also the reason of an entry refused inside a bulk write.
 */
export function validationDetail(err: ZodError): string {
  const byField = new Map<string, string[]>();
  for (const issue of err.issues) {
    const field = issue.path.join('.') || '(body)';
    byField.set(field, [...(byField.get(field) ?? []), issue.message]);
  }
  return `Invalid request: ${[...byField].map(([field, messages]) => `${field} (${messages.join('; ')})`).join(', ')}`;
}

export class AppError extends Error {
  /**
   * `code`, when given, is answered as `error`: a stable name a client can act on without reading the
   * Italian `detail` (as `{ detail, error }` elsewhere, e.g. `insufficient_scope`).
   */
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,80}$/;

/**
 * What the log says of an unexpected error: its kind, Prisma's code and the model and fields it names, the request's
 * method and path, and where it was thrown. Never its message: a Prisma validation error quotes the query's arguments
 * (the text the user was saving, an act with a client's name in it), and other errors may quote their input. Whoever
 * reads the logs on the host must not read that. The stack keeps its frames, not its first line, which repeats the
 * message. The path, not the URL: a query string can carry what the user searched for.
 */
export function describeUnexpectedError(err: unknown, req?: Pick<Request, 'method' | 'path'>): string {
  const where = req ? ` on ${req.method} ${String(req.path).slice(0, 200)}` : '';
  if (!(err instanceof Error)) return `a thrown ${typeof err}, not an Error${where}`;

  const parts = [SAFE_TOKEN.test(err.name) ? err.name : 'Error'];
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && SAFE_TOKEN.test(code)) parts.push(`code ${code}`);
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.meta) {
    const { modelName, target } = err.meta as { modelName?: unknown; target?: unknown };
    if (typeof modelName === 'string' && SAFE_TOKEN.test(modelName)) parts.push(`model ${modelName}`);
    const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
    const named = fields.filter((field): field is string => typeof field === 'string' && SAFE_TOKEN.test(field));
    if (named.length) parts.push(`fields ${named.join(',')}`);
  }

  // V8 writes `${name}: ${message}` first, then one line per frame: keep only the frames. A stack that does not start
  // with that header (rewritten by a library, or a message changed after the stack was read) cannot be told apart from
  // its message, so none of it is written.
  const stack = typeof err.stack === 'string' ? err.stack : '';
  const header = String(err);
  if (!stack.startsWith(header)) return `${parts.join(', ')}${where} (stack omitted)`;
  const frames = stack
    .slice(header.length)
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 10)
    .join('\n');
  return `${parts.join(', ')}${where}${frames ? `\n${frames}` : ''}`;
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      detail: err.message,
      ...(err.code ? { error: err.code } : {}),
    });
  }

  // Zod throws from 41 `.parse()` call sites across 13 controllers — every
  // write endpoint in the product. Without this branch each of them answered
  // 500 "Internal server error" for a body the CALLER got wrong: a validation
  // problem dressed up as a server fault, and unactionable, since the response
  // never said which field was missing.
  if (err instanceof ZodError) {
    const fields = err.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));

    // Logged, not silently converted: a burst of these usually means a client
    // and a schema have drifted apart. Kept to one line — a 400 is a normal
    // outcome, and the full stack would be noise at request volume.
    console.warn(
      'Validation rejected:',
      fields.map((f) => `${f.field}: ${f.message}`).join('; ')
    );

    return res.status(400).json({
      // `detail` stays a plain string. services/api.ts renders it straight to
      // the user, so an object here would reach them as "[object Object]".
      detail: validationDetail(err),
      // Ungrouped on purpose: one entry per violation, so a caller that wants
      // to highlight fields can, without parsing the prose above.
      errors: fields,
    });
  }

  // The JSON parser's own refusals (a malformed body, one too large) come before any route. Their
  // error carries the raw body (`err.body`), and the message of a malformed one quotes a piece of it:
  // neither is logged nor answered, since a body may hold a client's name (a planner task's title).
  const parserError = err as Error & { type?: unknown; status?: unknown };
  if (typeof parserError.type === 'string' && typeof parserError.status === 'number' && parserError.status >= 400 && parserError.status < 500) {
    console.warn(`Request body refused: ${parserError.type}`);
    const detail = parserError.type === 'entity.parse.failed' ? 'Invalid request: the body is not valid JSON' : 'Invalid request body';
    return res.status(parserError.status).json({ detail });
  }

  // Prisma's own outcome codes for a row that is not there (an update or
  // delete by id that raced a deletion) and for a unique-key collision (two
  // clicks on a vote toggle): the caller's state is stale, not the server's.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return res.status(404).json({ detail: 'Not found' });
    if (err.code === 'P2002') return res.status(409).json({ detail: 'Already exists' });
  }

  console.error(`Unexpected error: ${describeUnexpectedError(err, req)}`);

  return res.status(500).json({
    detail: 'Internal server error',
  });
};
