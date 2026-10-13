/**
 * The message a failed answer of the Python API carries (`{ "error": "…" }`, in Italian for the
 * reader), or `fallback` when the body says nothing readable. Until 13 October 2026 the search
 * replaced it with «Errore nella richiesta», so a range whose index could not be read said nothing
 * of why.
 */
export async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
    return typeof error === 'string' && error.trim() ? error.trim() : fallback;
  } catch {
    return fallback;
  }
}
