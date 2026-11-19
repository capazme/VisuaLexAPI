import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/bulletin');
/** The Forum: «Dossier pubblici» and the Community. Fixtures and tests apart. */
const files = (readdirSync(DIR) as string[]).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).sort();
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
/**
 * The confirmations that stay (L-74), grown from their button: parts of the page, kept in the checks of style. No window
 * over the content is left in the Forum (LC138, LC140): the suggestions' review and editing came into the page last.
 */
const CONFIRMATIONS = ['ArchivedEnvironmentsSection.tsx', 'BulletinBoardPage.tsx', 'CommunityThreadView.tsx', 'EditSuggestionDialog.tsx', 'VersionHistoryModal.tsx'];
const STYLED = files;

// LC114: the Forum speaks the common components' language, as Pratiche (LC106), Opus (LC110), Learn (LC112) and the
// reader (LC113). A bare `<button>`, `<select>` or `<input>` stays only with its reason written on the line above
// (`bare-button: …`): a row that is a whole option, a checkbox.
describe('Forum, the common components', () => {
  it('reads the Forum and the Community', () => {
    expect(files).toEqual(expect.arrayContaining(['ForumExploreView.tsx', 'CommunityThreadView.tsx', 'SuggestContentPanel.tsx']));
  });
  it('keeps no local button or field look of its own', () => {
    const local = STYLED.filter((name) => /\b(FILTER_BUTTON|INPUT|ACTION|LINK)\b/.test(read(name)));
    expect(local).toEqual([]);
  });

  // L-73, LC138: nothing over the content but the confirmations. No dialog role, veil, portal, popover or sheet comes in.
  it('opens no new window over the content', () => {
    const windows = files.filter((name) => /\.tsx$/.test(name) && (
      /(?<!\[)role=["{']*(alert)?dialog|role: '(alert)?dialog'|fixed inset-0|createPortal|FloatingPortal|<(Modal|ConfirmDialog|Sheet|WireConfirm)\b/.test(read(name))
    ));
    expect(windows).toEqual(CONFIRMATIONS);
  });
});
