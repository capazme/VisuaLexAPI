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
const WINDOW = 'a window over the content (L-73, L-74): out of its area\'s checks of style, its own PR brings it into the page';
const TEXTAREA = 'a `<textarea>`: its area\'s PR held buttons, menus and inputs, not yet `Textarea`';
const NO_AREA = 'no area PR among LC104–LC117 took it in';
const COMMON = 'a common component\'s own radius or time, not yet on `CONTROL_RADIUS`, `CARD_RADIUS` or the motion tokens';

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
  'components/ui/AdvancedExportModal.tsx': { radius: 9, why: WINDOW },
  'components/ui/AnnexSwitchDialog.tsx': { radius: 5, why: WINDOW },
  'components/ui/CopyModal.tsx': { radius: 6, why: WINDOW },
  'components/ui/Modal.tsx': { radius: 5, duration: 1, why: WINDOW },
  'components/ui/PDFViewer.tsx': { radius: 4, duration: 1, why: WINDOW },
  'components/ui/PreviewFrame.tsx': { radius: 2, duration: 1, why: WINDOW },
  'components/ui/Sheet.tsx': { radius: 2, why: WINDOW },

  'components/features/practice/RowDossierPanels.tsx': { bare: 1, why: TEXTAREA },
  'components/features/planner/TaskSheet.tsx': { bare: 1, why: TEXTAREA },
  'components/features/search/ArticleDiscussionPanel.tsx': { bare: 1, why: TEXTAREA },
  'components/features/search/NoteEditBox.tsx': { bare: 1, why: TEXTAREA },
  'components/features/search/discussionControls.tsx': { bare: 1, why: TEXTAREA },
  'components/features/studia/VoteBar.tsx': { bare: 1, why: TEXTAREA },
  'components/features/studia/corsi/ExamSession.tsx': { bare: 1, why: TEXTAREA },
  'components/features/studia/corsi/RecallStep.tsx': { bare: 1, why: TEXTAREA },
  'components/features/planner/QuickAddField.tsx': { bare: 1, why: 'an `<input>`: Opus\'s PR (LC110) held buttons and menus' },
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

  'components/ui/ChangelogNotification.tsx': { radius: 4, why: COMMON },
  'components/ui/CitationPreviewPopup.tsx': { radius: 1, why: COMMON },
  'components/ui/DecisionPreviewPopup.tsx': { radius: 1, why: COMMON },
  'components/ui/Expand.tsx': { duration: 1, why: COMMON },
  'components/ui/Input.tsx': { duration: 1, why: COMMON },
  'components/ui/IslandSurface.tsx': { radius: 2, why: COMMON },
  'components/ui/MenuButton.tsx': { radius: 1, why: COMMON },
  'components/ui/ProgressBar.tsx': { duration: 1, why: COMMON },
  'components/ui/SegmentedTabs.tsx': { radius: 1, duration: 1, why: COMMON },
  'components/ui/Skeleton.tsx': { radius: 4, why: COMMON },
  'components/ui/Switch.tsx': { duration: 2, why: COMMON },
  'components/ui/buttonStyles.ts': { duration: 1, why: COMMON },
  'components/ui/controlStyles.ts': { duration: 1, why: COMMON },
  'components/ui/notifications/NotificationCard.tsx': { radius: 5, duration: 1, why: COMMON },
  'components/ui/wireConfirm/OutcomeTick.tsx': { radius: 1, duration: 1, why: COMMON },
  'components/ui/wireConfirm/WireConfirm.tsx': { radius: 2, why: COMMON },
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
    expect(rules('pages/X.tsx', '"rounded-lg"\n"rounded-md rounded-[8px] rounded-full"\n"rounded-t-2xl"\n"rounded-[6px]"')).toEqual(['radius:1', 'radius:3', 'radius:4']);
    expect(rules('pages/X.tsx', '"duration-150"\ntransition={{ duration: 0.2 }}\ntoast(t, { duration: 4000 })')).toEqual(['duration:1', 'duration:2']);
    expect(rules('lib/motion.ts', 'export const X = { duration: 280 };')).toEqual([]);
  });

  it('reads no comment', () => {
    expect(rules('pages/X.tsx', '// a `<button>` drawn rounded-lg\n/**\n * duration-150 <select>\n */')).toEqual([]);
  });
});
