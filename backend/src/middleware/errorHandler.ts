import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      detail: err.message,
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

    // Grouped by field before it becomes prose. One value can break several
    // rules at once — a short password fails both the length check and the
    // complexity regex — and naming the field once per violation reads as
    // "password (...), password (...)".
    const byField = new Map<string, string[]>();
    for (const f of fields) {
      byField.set(f.field, [...(byField.get(f.field) ?? []), f.message]);
    }

    return res.status(400).json({
      // `detail` stays a plain string. services/api.ts renders it straight to
      // the user, so an object here would reach them as "[object Object]".
      detail: `Invalid request: ${[...byField]
        .map(([field, messages]) => `${field} (${messages.join('; ')})`)
        .join(', ')}`,
      // Ungrouped on purpose: one entry per violation, so a caller that wants
      // to highlight fields can, without parsing the prose above.
      errors: fields,
    });
  }

  console.error('Unexpected error:', err);

  return res.status(500).json({
    detail: 'Internal server error',
  });
};
