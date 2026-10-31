/**
 * The reasons a glossa, a reply or a comment can be reported for, and the categories a moderator hides
 * under: one closed list (spec 2026-10-20-forum-community-glosse-design §5.7), mirrored by the
 * migration's CHECKs.
 */
export const REPORT_REASONS = ['offensivo', 'dati_personali', 'spam', 'fuori_tema', 'diritti', 'altro'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const DETAILS_MAX = 1000;

export function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

/**
 * A reason from the closed list stays as it is. Any other text (the reader's panel sends
 * «segnalazione») becomes «altro», the text kept at the head of the details, as the migration did
 * with the stored reports. Pending PR2c: with the panel's reasons menu, a reason outside the list
 * becomes a 400.
 */
export function readReportReason(reason: string, details: string | undefined): { reason: ReportReason; details: string | null } {
  if (isReportReason(reason)) return { reason, details: details || null };
  const text = details ? `${reason}: ${details}` : reason;
  return { reason: 'altro', details: text.slice(0, DETAILS_MAX) };
}
