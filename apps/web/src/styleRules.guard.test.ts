import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { styleViolations, type StyleRule } from './test/commonControlsGuard';

// LC118: one guard for the whole app, so the controls written by hand do not come back. No bare `<button>`, `<select>`,
// `<input>` or `<textarea>` outside `components/ui` (a bare one only with its reason on the line above, `bare-button: …`),
// radii of 4 and 8 px, no duration by hand outside `lib/motion.ts`. The rules are `styleViolations`; the areas' guards
// keep what is theirs (their files, their local looks, `Switch`, their windows).
const src = __dirname; // apps/web/src

/** Folders out of the guard, each with why. */
const FOLDERS: Record<string, string> = {
  'features/merlt/': 'Labs (MERL-T): its PR (11 of 14) waits for MERL-T switched on',
};

const LABS = FOLDERS['features/merlt/'];
const WINDOW = 'a window over the content (L-73, L-74): its area\'s PR left it as it was, for the PR that brings it into the page';
const COMMON_WINDOW = 'a common window over the content (L-73, L-74): not among the common controls aligned so far';
const TEXTAREA = 'a `<textarea>`: its area\'s PR held buttons, menus and inputs, not yet `Textarea`';
const OPUS_FIELD = 'a field: Opus\'s PR (LC110) held buttons and menus';
const NO_AREA = 'no area PR among LC104–LC117 took it in';

type Counts = Partial<Record<StyleRule, number>>;
/**
 * Files still out of a rule, with how many lines and why. A list that only shortens: one more line fails, and so does
 * one less, until the count here goes down with it. A file brought into the rules leaves the list.
 */
const EXCEPTIONS: Record<string, Counts & { why: string }> = {
  'pages/MerltHubPage.tsx': { bare: 2, why: LABS },

  'components/features/bulletin/AddItemsDialog.tsx': { bare: 3, radius: 4, why: WINDOW },
  'components/features/bulletin/AliasConflictDialog.tsx': { bare: 5, radius: 4, why: WINDOW },
  'components/features/bulletin/EditSuggestionDialog.tsx': { bare: 5, radius: 6, why: WINDOW },
  'components/features/bulletin/PublishDossierPicker.tsx': { bare: 1, radius: 1, why: WINDOW },
  'components/features/bulletin/ReportModal.tsx': { bare: 4, radius: 7, why: WINDOW },
  'components/features/bulletin/SuggestionReviewDialog.tsx': { bare: 8, radius: 7, why: WINDOW },
  'components/features/bulletin/VersionHistoryModal.tsx': { radius: 2, why: WINDOW },
  'components/features/compare/CompareView.tsx': { bare: 14, radius: 23, duration: 1, why: WINDOW },
  'components/features/decisions/DecisionPreviewDialog.tsx': { bare: 1, radius: 1, duration: 1, why: WINDOW },
  'components/features/decisions/KeyPassagesMenu.tsx': { bare: 3, why: WINDOW },
  'components/features/documents/CompletionPicker.tsx': { bare: 2, radius: 5, why: WINDOW },
  'components/features/dossier/AddNoteModal.tsx': { radius: 1, why: WINDOW },
  'components/features/dossier/AddToDossierPopover.tsx': { radius: 3, duration: 3, why: WINDOW },
  'components/features/dossier/PublishDossierDialog.tsx': { radius: 4, why: WINDOW },
  'components/features/dossier/TreeNavigatorModal.tsx': { radius: 3, why: WINDOW },
  'components/features/practice/CorpusPracticesDialog.tsx': { radius: 1, why: WINDOW },
  'components/features/practice/PracticeDossierPicker.tsx': { bare: 2, radius: 1, why: WINDOW },
  'components/features/search/BlockAnnotationsSheet.tsx': { bare: 3, radius: 1, why: WINDOW },
  'components/features/search/NotesPeekPanel.tsx': { bare: 7, radius: 2, duration: 3, why: WINDOW },
  'components/ui/AdvancedExportModal.tsx': { radius: 9, why: COMMON_WINDOW },
  'components/ui/AnnexSwitchDialog.tsx': { radius: 5, why: COMMON_WINDOW },
  'components/ui/CopyModal.tsx': { radius: 6, why: COMMON_WINDOW },
  'components/ui/Modal.tsx': { radius: 6, duration: 1, why: COMMON_WINDOW },
  'components/ui/PDFViewer.tsx': { radius: 4, duration: 1, why: COMMON_WINDOW },
  'components/ui/PreviewFrame.tsx': { radius: 2, duration: 1, why: COMMON_WINDOW },
  'components/ui/Sheet.tsx': { radius: 2, why: COMMON_WINDOW },

  'components/features/practice/RowDossierPanels.tsx': { bare: 1, why: TEXTAREA },
  'components/features/planner/TaskSheet.tsx': { bare: 1, why: OPUS_FIELD },
  'components/features/search/ArticleDiscussionPanel.tsx': { bare: 1, why: TEXTAREA },
  'components/features/search/NoteEditBox.tsx': { bare: 1, why: TEXTAREA },
  'components/features/search/discussionControls.tsx': { bare: 1, why: TEXTAREA },
  'components/features/studia/VoteBar.tsx': { bare: 1, why: TEXTAREA },
  'components/features/studia/corsi/ExamSession.tsx': { bare: 1, why: TEXTAREA },
  'components/features/studia/corsi/RecallStep.tsx': { bare: 1, why: TEXTAREA },
  'components/features/planner/QuickAddField.tsx': { bare: 1, why: OPUS_FIELD },
  'components/features/dossier/DossierDecisionReader.tsx': { radius: 1, why: 'Pratiche\'s PR (LC106) held buttons and menus, not radii' },
  'components/features/dossier/DossierKindChoice.tsx': { radius: 1, why: 'Pratiche\'s PR (LC106) held buttons and menus, not radii' },
  'components/features/studia/ReviewSession.tsx': { duration: 1, why: 'Web Animations\' milliseconds: Learn\'s PR (LC112) held the `duration-*` classes' },
  'components/features/studia/missions/MissionMark.tsx': { duration: 2, why: 'Framer\'s seconds: Learn\'s PR (LC112) held the `duration-*` classes' },
  'components/features/studia/progress/StreakTally.tsx': { duration: 2, why: 'Framer\'s seconds: Learn\'s PR (LC112) held the `duration-*` classes' },
  'components/auth/AdminRoute.tsx': { radius: 1, why: '«Accesso negato»: out of LC116, left to the admin page\'s PR, which did not take it' },

  'components/features/atti/IstruzioniPerClaude.tsx': { bare: 1, radius: 1, why: NO_AREA },
  'components/features/atti/DossierAttiPanel.tsx': { radius: 1, why: NO_AREA },
  'components/features/atti/PraticaFilesPanel.tsx': { radius: 1, why: NO_AREA },
  'components/features/workspace/ArticleNavigation.tsx': { bare: 4, why: NO_AREA },
  'components/features/workspace/StudyMode/StudyMode.tsx': { radius: 1, duration: 1, why: NO_AREA },
  'components/features/workspace/StudyMode/StudyModeContent.tsx': { duration: 2, why: NO_AREA },
  'components/features/workspace/StudyMode/StudyModeHeader.tsx': { bare: 11, radius: 1, why: NO_AREA },
  'components/features/workspace/StudyMode/StudyModeSettings.tsx': { bare: 10, radius: 6, why: NO_AREA },
  'components/features/workspace/StudyMode/StudyModeSummary.tsx': { bare: 4, radius: 1, why: NO_AREA },
  'components/features/workspace/StudyMode/StudyModeToolsPanel.tsx': { bare: 7, radius: 5, why: NO_AREA },
  'components/layout/Layout.tsx': { bare: 2, radius: 2, duration: 1, why: NO_AREA },
  'components/layout/PhoneTopBar.tsx': { bare: 2, radius: 1, duration: 3, why: NO_AREA },
  'components/layout/RouteBoundary.tsx': { bare: 1, why: NO_AREA },
  'components/layout/Sidebar.tsx': { bare: 13, radius: 10, why: NO_AREA },
  'components/layout/TopBar.tsx': { bare: 1, why: NO_AREA },
  'features/connections/AiWaysDiagram.tsx': { bare: 1, radius: 3, why: NO_AREA },
  'features/connections/ConnectAiAppPage.tsx': { radius: 4, duration: 1, why: NO_AREA },
  'features/connections/ConnectedAppsSection.tsx': { bare: 1, radius: 3, why: NO_AREA },
  'features/connections/CopyableCode.tsx': { bare: 1, radius: 1, duration: 1, why: NO_AREA },
  'features/deadlines/DeadlineCard.tsx': { bare: 2, radius: 2, why: NO_AREA },
  'features/sections/SectionSwitcher.tsx': { bare: 4, radius: 6, duration: 2, why: NO_AREA },
  'features/sections/SectionTabs.tsx': { bare: 1, duration: 1, why: NO_AREA },
  'features/welcome/WelcomeGuide.tsx': { bare: 1, why: NO_AREA },
  'pages/CreditsPage.tsx': { radius: 2, why: NO_AREA },
  'constants/interactions.ts': { duration: 1, why: '`TRANSITION`, the shared hover and press (150 ms): a token in all but name, not yet on `--dur-*`' },
};

/**
 * `rounded-full` (LC119): only for a pill or a circle, never a box's corners. The island's pill, `Switch`, an avatar, a
 * dot, a count's badge, a spinner, a bar of progress. The files that draw one today, with how many; a new one comes in
 * with its line here, said what it rounds, and a box rounded full is drawn on `CONTROL_RADIUS` or `CARD_RADIUS` instead.
 */
const PILLS: Record<string, number> = {
  'components/auth/AdminRoute.tsx': 1,
  'components/auth/RegisterForm.tsx': 1,
  'components/features/bulletin/CommunityThreadView.tsx': 3,
  'components/features/bulletin/EnvironmentContentViewer.tsx': 1,
  'components/features/bulletin/ForumCommunityPage.tsx': 3,
  'components/features/bulletin/ForumSuggestionsView.tsx': 4,
  'components/features/bulletin/ForumTabs.tsx': 1,
  'components/features/bulletin/ReportModal.tsx': 1,
  'components/features/bulletin/SharedEnvironmentCard.tsx': 6,
  'components/features/bulletin/StudyPacksBand.tsx': 1,
  'components/features/bulletin/SuggestContentPanel.tsx': 5,
  'components/features/bulletin/SuggestionItemCard.tsx': 3,
  'components/features/compare/compareParts.tsx': 1,
  'components/features/documents/CitationList.tsx': 1,
  'components/features/documents/DocumentRow.tsx': 2,
  'components/features/dossier/DossierDetailView.tsx': 1,
  'components/features/dossier/DossierListView.tsx': 1,
  'components/features/history/NormaChangesSection.tsx': 1,
  'components/features/planner/QuickAddField.tsx': 1,
  'components/features/planner/TaskCheckbox.tsx': 2,
  'components/features/planner/WeekStrip.tsx': 1,
  'components/features/practice/PracticeParts.tsx': 1,
  'components/features/practice/ReadingRow.tsx': 1,
  'components/features/rassegne/RassegneSearchPage.tsx': 1,
  'components/features/search/ArticleBody.tsx': 1,
  'components/features/search/CaseLawSection.tsx': 1,
  'components/features/search/CommandPalette.tsx': 1,
  'components/features/search/GlossCard.tsx': 1,
  'components/features/search/HighlightMeaningsSection.tsx': 1,
  'components/features/search/NotesHighlightsButtons.tsx': 2,
  'components/features/search/NotesPeekPanel.tsx': 1,
  'components/features/search/ReadingBackControl.tsx': 1,
  'components/features/search/Scrivania.tsx': 1,
  'components/features/search/SearchPanel.tsx': 1,
  'components/features/search/caseLaw/CaseLawControls.tsx': 1,
  'components/features/search/caseLaw/CaseLawRow.tsx': 1,
  'components/features/settings/AliasSection.tsx': 1,
  'components/features/studia/ArticleCardsPeek.tsx': 1,
  'components/features/studia/CardForm.tsx': 2,
  'components/features/studia/CardGroups.tsx': 2,
  'components/features/studia/LessonFrame.tsx': 1,
  'components/features/studia/ReviewSession.tsx': 3,
  'components/features/studia/corsi/CoursePage.tsx': 1,
  'components/features/studia/corsi/CourseSections.tsx': 1,
  'components/features/studia/corsi/CourseTrail.tsx': 1,
  'components/features/studia/corsi/CoursesView.tsx': 1,
  'components/features/studia/lezione/LessonSession.tsx': 3,
  'components/features/studia/missions/MissionList.tsx': 1,
  'components/features/studia/missions/MissionMark.tsx': 6,
  'components/features/studia/missions/TodayMissions.tsx': 1,
  'components/features/studia/progress/GoalRing.tsx': 2,
  'components/features/studia/progress/InstituteStops.tsx': 2,
  'components/features/studia/progress/LearnPath.tsx': 4,
  'components/features/studia/progress/LevelBar.tsx': 2,
  'components/features/studia/progress/StatsBand.tsx': 1,
  'components/features/studia/progress/SubjectChips.tsx': 1,
  'components/features/studia/progress/SubjectList.tsx': 3,
  'components/features/studia/progress/SubjectProgress.tsx': 1,
  'components/features/studia/progress/XpGain.tsx': 1,
  'components/features/workspace/StudyMode/StudyModeContent.tsx': 1,
  'components/features/workspace/StudyMode/StudyModeSummary.tsx': 3,
  'components/layout/Layout.tsx': 1,
  'components/layout/Sidebar.tsx': 2,
  'components/ui/AdvancedExportModal.tsx': 1,
  'components/ui/Button.tsx': 1,
  'components/ui/ChangelogNotification.tsx': 2,
  'components/ui/CopyModal.tsx': 2,
  'components/ui/IconButton.tsx': 1,
  'components/ui/MenuButton.tsx': 1,
  'components/ui/PDFViewer.tsx': 1,
  'components/ui/ProgressBar.tsx': 3,
  'components/ui/ServiceHealthMenuEntry.tsx': 1,
  'components/ui/Skeleton.tsx': 1,
  'components/ui/Switch.tsx': 3,
  'features/connections/AiWaysDiagram.tsx': 1,
  'features/sections/SectionSwitcher.tsx': 2,
  'features/sections/SectionTabs.tsx': 1,
  'features/welcome/WelcomeGuide.tsx': 1,
  'utils/searchFieldControl.ts': 1,
};

/** Every source of the app, tests and fixtures apart. */
const files = (readdirSync(src, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$|\.d\.ts$|__tests__|__fixtures__|^test\//.test(f))
  .sort();

describe('the app\'s rules of style (LC118)', () => {
  it('reads the whole app', () => {
    expect(files).toEqual(expect.arrayContaining(['components/layout/Sidebar.tsx', 'components/features/dossier/DossierListView.tsx', 'pages/AdminPage.tsx']));
  });

  it('keeps every control, radius and duration to the rules, but the exceptions, line for line', () => {
    const found: Record<string, Counts> = {};
    for (const f of files.filter((f) => !Object.keys(FOLDERS).some((dir) => f.startsWith(dir)))) {
      for (const { rule } of styleViolations(f, readFileSync(join(src, f), 'utf8'))) (found[f] ??= {})[rule] = (found[f]?.[rule] ?? 0) + 1;
    }
    const expected = Object.fromEntries(Object.entries(EXCEPTIONS).map(([f, counts]) => [f, { ...counts, why: undefined }]));
    expect(found).toEqual(expected);
  });

  it('rounds full only the pills and circles of the list, one for one', () => {
    const found = Object.fromEntries(files.filter((f) => !Object.keys(FOLDERS).some((dir) => f.startsWith(dir)))
      .map((f) => [f, (readFileSync(join(src, f), 'utf8').match(/\brounded-full\b/g) ?? []).length] as const).filter(([, n]) => n > 0));
    expect(found).toEqual(PILLS);
  });

  it('gives every exception a reason and a folder that is still there', () => {
    expect(Object.entries({ ...FOLDERS, ...Object.fromEntries(Object.entries(EXCEPTIONS).map(([f, { why }]) => [f, why])) })
      .filter(([path, why]) => !why || !existsSync(join(src, path)))).toEqual([]);
  });
});

describe('styleViolations', () => {
  const rules = (path: string, source: string) => styleViolations(path, source).map(({ rule, line }) => `${rule}:${line}`);

  it('fails on a bare `<button>` with no reason', () => {
    expect(rules('pages/X.tsx', '<div>\n  <button type="button" onClick={go}>Vai</button>\n</div>')).toEqual(['bare:2']);
  });

  it('lets a bare control pass with its reason on the line above, and inside `components/ui`', () => {
    expect(rules('pages/X.tsx', '{/* bare-button: the whole row is the option */}\n<button type="button">Riga</button>')).toEqual([]);
    expect(rules('components/ui/Button.tsx', '<button type="button" />')).toEqual([]);
  });

  it('fails on a bare field and menu, not on a checkbox, a radio, a file or a hidden input, even over lines', () => {
    expect(rules('pages/X.tsx', '<input\n  value={v}\n  onChange={(e) => set(e.target.value)}\n/>\n<textarea />\n<select>')).toEqual(['bare:1', 'bare:5', 'bare:6']);
    expect(rules('pages/X.tsx', '<input\n  onChange={(e) => set(e.target.checked)}\n  type="checkbox"\n/>\n<input type="file" hidden />')).toEqual([]);
  });

  it('fails on a radius other than 4 and 8 px, and on a duration by hand outside `lib/motion.ts`', () => {
    expect(rules('pages/X.tsx', '"rounded-lg"\n"rounded-md rounded-[8px] rounded-full"\n"rounded-t-2xl rounded-s-xl"\n"rounded-[6px]"')).toEqual(['radius:1', 'radius:3', 'radius:4']);
    expect(rules('pages/X.tsx', '"duration-150"\ntransition={{ duration: 0.2 }}\ntoast(t, { duration: 4000 })')).toEqual(['duration:1', 'duration:2']);
    expect(rules('lib/motion.ts', 'export const X = { duration: 280 };')).toEqual([]);
  });

  it('reads no comment', () => {
    expect(rules('pages/X.tsx', '// a `<button>` drawn rounded-lg\n/**\n * duration-150 <select>\n */')).toEqual([]);
  });
});
