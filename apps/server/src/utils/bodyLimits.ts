import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

/**
 * How long a field of a request body may be, for the controllers that had no limit (item 14 of the security
 * inventory). The request is capped at 2 MB as a whole (`app.ts`); below that, one account could fill the disk
 * faster than the newer routes allow. Each limit is far above what a person writes, and a refusal names the field in
 * Italian, so the web can show it and nothing is cut silently.
 */

/** 50000 → «50.000», as an Italian reader writes it (no dependence on the runtime's locale data). */
const italianNumber = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const tooLong = (field: string, max: number) => `Campo «${field}»: al massimo ${italianNumber(max)} caratteri.`;
export const tooMany = (field: string, max: number) => `Campo «${field}»: al massimo ${italianNumber(max)} voci.`;

/** A string of at most `max` characters as zod 4 counts them (code points: a UTF-16 `.length` up to twice that). */
export const boundedText = (max: number, field: string) => z.string().max(max, tooLong(field, max));

/** At most `max` tags, each at most `each` units. */
export const boundedTags = (max: number, each: number, field = 'tag') =>
  z.array(boundedText(each, field)).max(max, tooMany(field, max));

/**
 * Parses a request body. A field over its limit is refused alone, with its Italian words and `error: "too_long"`;
 * any other problem goes to the global handler as before.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  refuseTooLong(result.error);
  throw result.error;
}

/** Throws the Italian refusal when the failure is a text or a list over its limit; a number out of range is not one. */
export function refuseTooLong(error: z.ZodError): void {
  const tooBig = error.issues.find(
    (issue) => issue.code === 'too_big' && (issue.origin === 'string' || issue.origin === 'array'),
  );
  if (tooBig) throw new AppError(400, tooBig.message, 'too_long');
}
