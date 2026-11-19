import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FEATURES = resolve(process.cwd(), 'src/components/features');
/**
 * The search and the reader: `search/` with its sub-folders (`caseLaw/`), and `practice/`, the reading table where an
 * article, its glosses, its case law and the dossier's «Fonti» are read. Fixtures and tests apart.
 */
const DIRS = ['search', 'practice'];
const files = DIRS.flatMap((dir) => (readdirSync(join(FEATURES, dir), { recursive: true }) as string[])
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes('__tests__') && !name.includes('__fixtures__'))
  .map((name) => `${dir}/${name}`))
  .sort();
const read = (name: string) => readFileSync(join(FEATURES, name), 'utf8');
/**
 * The windows over the content still here (L-73), for the PRs after LC139 (which brought the toolbar's «Note»,
 * «Evidenziazioni», «Copia», «Esporta» and «Testo alla data» into the page) and LC142 (a block's annotations, under it). The first four are left out of the checks of
 * style below; the others were already in them.
 */
const UNSTYLED = ['practice/CorpusPracticesDialog.tsx', 'practice/PracticeDossierPicker.tsx', 'search/NoteComposerSheet.tsx'];
const WINDOWS = [...UNSTYLED, 'search/ArticleDiscussionPanel.tsx', 'search/FindWindow.tsx', 'search/MoveProposalBar.tsx', 'search/UpdateNotePopover.tsx'];
/** The confirmations that stay (L-74), grown from their button. */
const CONFIRMATIONS = ['search/discussionControls.tsx'];
/**
 * Over the page by choice, each with why: ⌘K's island grows from its pill (L-75); the glosses' margin is a portal into a
 * slot of the page, in its flow; a block's space (`BlockSpace`, LC142) is a portal into the text itself, after its block,
 * in its flow; the save to a practice's notice is a notification (L-74). Not caught by the check, and over the text by
 * Luca's choice (LC142, option A, L-74's «strictly necessary»): `SelectionPopup`'s island, where the paragraph goes on
 * far below the selected words; under the paragraph otherwise.
 */
const ALLOWED = ['search/CommandPalette.tsx', 'search/ArticleTabContent.tsx', 'search/BlockSpace.tsx', 'practice/usePracticeSaveActions.tsx'];
const STYLED = files.filter((name) => !UNSTYLED.includes(name));

// LC113: the search and the reader speak the common components' language, as Pratiche (LC106), Opus (LC110) and Learn
// (LC112). A bare `<button>`, `<select>` or `<input>` stays only with its reason written on the line above
// (`bare-button: …`): a row that is a whole option, a mark in the text, a checkbox, a colour swatch.
describe('Search and reader, the common components', () => {
  it('reads the sub-folders and the reader too', () => {
    expect(files).toEqual(expect.arrayContaining(['search/caseLaw/CaseLawRow.tsx', 'search/CommandPalette.tsx', 'practice/PracticeRowShell.tsx']));
  });
  it('keeps no local button or field look of its own', () => {
    const local = STYLED.filter((name) => /\b(ACTION|LINK|FIELD_INPUT|SMALL_INPUT|ICON_BUTTON|QUIET_BUTTON|TOOL_BUTTON|ADD_BUTTON|REMOVE_BUTTON|SCOPE_BUTTON|TOOL_LINK)\b/.test(read(name)));
    expect(local).toEqual([]);
  });

  // L-73, LC139: nothing over the content but the confirmations and what is allowed. No dialog role, veil, portal,
  // popover or sheet comes in.
  it('opens no new window over the content', () => {
    const windows = files.filter((name) => /\.tsx$/.test(name) && (
      /(?<!\[)role=["{']*(alert)?dialog|role: '(alert)?dialog'|fixed inset-0|createPortal|FloatingPortal|<(Modal|ConfirmDialog|Sheet|WireConfirm)\b/.test(read(name))
    ));
    expect(windows).toEqual([...WINDOWS, ...CONFIRMATIONS, ...ALLOWED].sort());
  });

  // L-74 (LC142): the citation previews on hover are allowed over the text as pure tooltips (`role="tooltip"`): words
  // only, nothing to press or scroll. The click on the citation opens the norm or the decision beside the text.
  it('keeps the citation previews pure tooltips', () => {
    const UI = resolve(process.cwd(), 'src/components/ui');
    for (const name of ['CitationPreviewPopup.tsx', 'DecisionPreviewPopup.tsx']) {
      const source = readFileSync(join(UI, name), 'utf8');
      // The scroll is checked by their own tests: the list's dialog shares the decision's body and keeps it.
      expect(source, name).not.toMatch(/<button|<Button|onClick|footer=/);
    }
  });
});
