/** The statuses whose `error` the Python API words for the reader, in Italian: a malformed request,
 *  an article or a range not in the act, an index that cannot be read. A 429 or another 5xx carries
 *  the rate limit's English or an exception's own text, never shown. */
const WORDED_FOR_THE_READER = new Set([400, 404, 503]);

/**
 * The message a failed answer of the Python API carries (`{ "error": "…" }`, in Italian for the
 * reader), or `fallback` when the status is not one it words for the reader or the body says nothing
 * readable. Until 13 October 2026 the search replaced it with «Errore nella richiesta», so a range
 * whose index could not be read said nothing of why.
 */
export async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  if (!WORDED_FOR_THE_READER.has(response.status)) return fallback;
  try {
    const body: unknown = await response.json();
    const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
    return typeof error === 'string' && error.trim() ? error.trim() : fallback;
  } catch {
    return fallback;
  }
}
