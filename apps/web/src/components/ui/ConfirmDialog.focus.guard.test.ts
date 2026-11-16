import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Every `ConfirmDialog` says where its focus starts (LC18, #457): on «Annulla» (`focusCancel`) when the action deletes or
// cannot be undone, so an Enter pressed at once acts on nothing; on the action when it can be undone. A new confirmation
// is classified here. Each entry: the file, then a piece of the title that tells its dialog apart.
const CANCEL_FIRST: [string, string][] = [
  ['components/features/history/HistoryView.tsx', 'Svuotare la cronologia?'],
  ['components/features/dossier/TrashEntryRow.tsx', 'Eliminare definitivamente?'],
  ['components/features/admin/CoursesSwitchAdmin.tsx', 'Spegnere i percorsi?'],
  ['components/features/bulletin/ArchivedEnvironmentsSection.tsx', "Eliminare l'ambiente"],
  ['components/features/bulletin/EditSuggestionDialog.tsx', 'Revocare questo item?'],
  ['components/features/bulletin/EditSuggestionDialog.tsx', 'Revocare ${pendingCount}'],
  ['components/features/studia/CardDetail.tsx', 'Ritirare la proposta?'],
  ['components/features/studia/CardDetail.tsx', 'Eliminare la scheda?'],
  ['components/features/studia/corsi/CoursePage.tsx', 'Il programma finisce con'],
  ['components/features/studia/corsi/CoursePage.tsx', 'Ritirare il modulo'],
  ['components/features/search/discussionControls.tsx', 'Segnalare ai moderatori?'],
  ['components/features/atti/PraticaFilesPanel.tsx', 'Eliminare il file?'],
  ['components/features/atti/PraticaFilesPanel.tsx', 'Prima di caricare il primo file'], // the notice is read before the first upload
];
/** Undone by another step, so the focus may start on the action. */
const ACTION_FIRST: [string, string][] = [
  ['components/features/bulletin/VersionHistoryModal.tsx', 'Ripristinare'], // the current state is saved as a version
  ['components/features/admin/StudiaTextsAdmin.tsx', 'Salvare come nuova versione?'], // the earlier versions stay
];

const src = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Each `<ConfirmDialog … />` of the sources, with its file. */
function dialogs(): { file: string; block: string }[] {
  return sources(src).flatMap((path) => {
    const file = relative(src, path);
    return [...readFileSync(path, 'utf8').matchAll(/<ConfirmDialog\b[\s\S]*?\/>/g)].map((m) => ({ file, block: m[0] }));
  });
}

describe('where a confirmation starts its focus', () => {
  const all = dialogs();
  const find = ([file, title]: [string, string]) => all.filter((d) => d.file === file && d.block.includes(title));

  it('every confirmation that deletes or cannot be undone starts on «Annulla»', () => {
    for (const entry of CANCEL_FIRST) {
      const found = find(entry);
      expect(found, entry.join(' · ')).toHaveLength(1);
      expect(found[0].block, entry.join(' · ')).toMatch(/\bfocusCancel\b/);
    }
  });

  it('the ones that can be undone start on the action', () => {
    for (const entry of ACTION_FIRST) {
      const found = find(entry);
      expect(found, entry.join(' · ')).toHaveLength(1);
      expect(found[0].block, entry.join(' · ')).not.toMatch(/\bfocusCancel\b/);
    }
  });

  it('none is left out of the two lists', () => {
    const listed = [...CANCEL_FIRST, ...ACTION_FIRST];
    const unlisted = all.filter((d) => !listed.some(([file, title]) => d.file === file && d.block.includes(title)));
    expect(unlisted.map((d) => `${d.file}: ${d.block.slice(0, 120)}`)).toEqual([]);
  });
});
