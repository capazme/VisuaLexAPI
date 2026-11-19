import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/dossier');
const files = readdirSync(DIR).filter((name) => /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name));

// LC106: Pratiche speak the common components' language; their bare controls are the app's guard's (LC118).
describe('Pratiche, the common components', () => {
  // LC107 (L-73): nothing over the content. «Modifica» and «Importa» open in the page; the windows still listed here
  // go in F3's other PR (nota, PDF, pubblica, norma, aggiungi, cestino), and no new one comes in.
  it('opens no new window over the content', () => {
    const windows = [...files].sort().filter((name) => /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog)\b/.test(readFileSync(join(DIR, name), 'utf8')));
    expect(windows).toEqual([
      'AddNoteModal.tsx', 'AddToDossierPopover.tsx', 'DossierPdfDialog.tsx', 'PublishDossierDialog.tsx', 'TrashEntryRow.tsx', 'TreeNavigatorModal.tsx',
    ]);
  });

  it('keeps no local button look of its own', () => {
    const local = files.filter((name) => /\b(LIST_MENU|HEADER_PRIMARY|LINK_BUTTON)\b/.test(readFileSync(join(DIR, name), 'utf8')));
    expect(local).toEqual([]);
  });
});
