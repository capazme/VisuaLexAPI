/**
 * A failure the model should read and the user understand: it becomes a tool
 * result with `isError: true` and this Italian text, never a protocol error.
 */
export class ToolError extends Error {}

/**
 * The API gave no answer (the request failed, timed out, or a gateway said so): it may have done what it was asked,
 * in part or whole. A caller that wrote before must not report the rows as refused (D8 S1).
 */
export class NoAnswer extends ToolError {}

/** The renewal time, in Italian, from an ISO date. */
export function formatRenewal(iso: string | null | undefined): string {
  if (!iso) return 'tra 24 ore';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'tra 24 ore';
  return `il ${date.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`;
}
