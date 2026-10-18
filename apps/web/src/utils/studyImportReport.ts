import type { StudyImportReport } from '../types';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What becoming study dossiers did, in one sentence for a toast: what was added, what the user already had
 * (skipped, never added twice) and what could not be read (spec D8–D9).
 */
export function studyImportSentence(report: StudyImportReport): string {
  const added = [
    report.dossiers.length ? count(report.dossiers.length, 'dossier di studio', 'dossier di studio') : null,
    report.notes.added ? count(report.notes.added, 'nota', 'note') : null,
    report.highlights.added ? count(report.highlights.added, 'evidenziazione', 'evidenziazioni') : null,
    report.quickNorms.added ? count(report.quickNorms.added, 'norma rapida', 'norme rapide') : null,
    report.aliases.added ? count(report.aliases.added, 'alias', 'alias') : null,
  ].filter(Boolean);
  const kept = report.notes.skipped + report.highlights.skipped + report.quickNorms.skipped + report.aliases.skipped;
  const parts = [added.length ? `Aggiunti: ${added.join(', ')}.` : 'Nessun dossier aggiunto.'];
  if (kept) parts.push(`Già tuoi o senza posizione nel testo, quindi non aggiunti: ${kept}.`);
  if (report.refused) parts.push(`Non leggibili e lasciati fuori: ${report.refused}.`);
  return parts.join(' ');
}

/** «diventa un tuo dossier di studio» / «diventa N tuoi dossier di studio». */
export function becomesStudyDossiers(count: number): string {
  return count === 1 ? 'diventa un tuo dossier di studio.' : `diventa ${count} tuoi dossier di studio.`;
}
