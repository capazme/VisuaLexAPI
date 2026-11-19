import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/components/features/studia');
/** Every source of Learn, its sub-folders too (`progress/`, `corsi/`, `lezione/`, `missions/`), fixtures and tests apart. */
const files = (readdirSync(DIR, { recursive: true }) as string[])
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes('__fixtures__'))
  .map((name) => relative(DIR, join(DIR, name)))
  .sort();
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

// LC112: Learn speaks the common components' language, as Pratiche (LC106) and Opus (LC110). A bare `<button>`,
// `<select>` or `<input>` stays only with its reason written on the line above (`bare-button: …`): a radio, a row that
// is a whole option, a chip, the lesson's grades.
describe('Learn, no bare controls', () => {
  it('reads the sub-folders too', () => {
    expect(files).toEqual(expect.arrayContaining(['progress/ProgressPage.tsx', 'corsi/ModuleSession.tsx', 'lezione/LessonSession.tsx', 'missions/DayBlock.tsx']));
  });
  it('keeps no local button or field look of its own', () => {
    const local = files.filter((name) => /\b(INK_BUTTON|SECONDARY_BUTTON|QUIET_BUTTON|LESSON_PRIMARY|CONTROL)\b/.test(read(name)));
    expect(local).toEqual([]);
  });
  // L-73: nothing over the content. A new card opens in the page (`CardFormPanel`); the windows still listed here are
  // the reader's (the card form and the peek under an article), the declaration to accept, the lesson's own frame and
  // its confirmations, the citation on a phone. No new one comes in.
  it('opens no new window over the content', () => {
    const windows = files.filter((name) => /\.tsx$/.test(name) && /(?<!\[)role="dialog"|fixed inset-0|<(Modal|ConfirmDialog|Sheet)\b/.test(read(name)));
    expect(windows).toEqual([
      'AcceptTextDialog.tsx', 'ArticleCardsPeek.tsx', 'CardDetail.tsx', 'CardFormDialog.tsx', 'LessonFrame.tsx', 'ReviewSession.tsx',
      'corsi/CitationPanel.tsx', 'corsi/CoursePage.tsx', 'lezione/LessonSession.tsx',
    ]);
    // The card's form in its window is the reader's alone; «Le mie schede» opens it in the page.
    expect(files.filter((name) => /<CardFormDialog\b/.test(read(name)))).toEqual(['ArticleCardsRow.tsx']);
  });
});
