import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/dossier');
const files = readdirSync(DIR).filter((name) => /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name));

// LC106: Pratiche speak the common components' language; their bare controls are the app's guard's (LC118).
describe('Pratiche, the common components', () => {
  // LC107, LC125 (L-73): nothing over the content. «Modifica», «Importa», the note, «Importa da norma», the PDF,
  // «Pubblica nel Forum» and «Aggiungi alla pratica» open in the page. Only confirmations stay (L-74): the trash's
  // «Elimina definitivamente» and the Forum copy's «Elimina dai dossier pubblici». No other window comes in: no dialog
  // role, veil, portal, popover or sheet.
  it('opens no window over the content but the confirmations', () => {
    const windows = [...files].sort().filter((name) => (
      /(?<!\[)role=["{']*(alert)?dialog|role: '(alert)?dialog'|fixed inset-0|createPortal|FloatingPortal|<(Modal|ConfirmDialog|Sheet|WireConfirm)\b/
        .test(readFileSync(join(DIR, name), 'utf8'))
    ));
    expect(windows).toEqual(['DossierForumActions.tsx', 'TrashEntryRow.tsx']);
  });

  it('keeps no local button look of its own', () => {
    const local = files.filter((name) => /\b(LIST_MENU|HEADER_PRIMARY|LINK_BUTTON)\b/.test(readFileSync(join(DIR, name), 'utf8')));
    expect(local).toEqual([]);
  });
});
