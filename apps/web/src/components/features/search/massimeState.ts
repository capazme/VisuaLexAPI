export type MassimeState = 'answered' | 'failed' | 'hidden';

/** What Brocardi did for this article, as the section shows it: answered (its info is present),
 *  failed (it sent an error and no info), or nothing to show (a past text, or Brocardi not asked). */
export function massimeStateOf(doctrineVisible: boolean, brocardiInfo: unknown, brocardiError: unknown): MassimeState {
  if (!doctrineVisible) return 'hidden';
  if (brocardiInfo !== undefined && brocardiInfo !== null) return 'answered';
  return brocardiError ? 'failed' : 'hidden';
}
