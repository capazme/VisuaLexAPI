import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

/**
 * Parses with Zod but answers with the first message alone, in Italian: the global handler's English
 * prefix is not for the discussion and Community routes.
 */
export function parseItalian<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, result.error.issues[0].message);
  return result.data;
}
