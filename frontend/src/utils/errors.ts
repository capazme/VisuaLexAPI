/**
 * Safely extract a human-readable message from an unknown thrown/rejected value.
 *
 * Rejections in this codebase are either native Errors or the plain
 * `{ status, message, data }` object produced by the axios interceptor in
 * `services/api.ts`. Both expose a `message` field, so we read it structurally
 * rather than assuming an `Error` instance.
 */
export function getErrorMessage(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return undefined;
}
