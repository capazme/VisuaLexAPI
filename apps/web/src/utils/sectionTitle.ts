/**
 * Strip Normattiva's amendment markers from a section heading.
 *
 * The article tree emits headings still wrapped in the literal `(( ))` the site
 * uses to mark amended text, plus the odd stray guillemet: "((§ 3 DEL SISTEMA
 * CON CONSIGLIO DI SORVEGLIANZA))". In the reading index that is noise — the
 * reader is scanning for where they are in the code, not for what was amended.
 *
 * A heading left with nothing but punctuation falls back to a neutral label:
 * the codice civile really does carry a "((...))" heading, and rendering "..."
 * as a section title reads as a bug.
 *
 * Lives here rather than beside the panel because a file that exports a
 * component may not also export plain functions — `react-refresh` fails the
 * lint gate on it.
 */
export function cleanSectionTitle(title: string): string {
  const cleaned = title
    .replace(/\(\(|\)\)/g, '')
    .replace(/[«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : 'Articoli';
}
