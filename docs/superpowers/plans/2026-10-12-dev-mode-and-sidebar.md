# Plan: a quieter sidebar, and a per-user development mode

Spec: `docs/superpowers/specs/2026-10-12-dev-mode-and-sidebar.md`. One PR, branch `feat/dev-mode`,
from `develop` after P4 of the norm-tab redesign (#134). Migration `20261020100000_user_dev_mode`.

## Global constraints

- UI copy in Italian; code, comments, commits and docs in English.
- The migration is written by hand and applied with `prisma migrate deploy`; never `migrate dev`
  or `migrate reset` against the development database. The server suite runs only through
  `npm --prefix apps/server test`, against the test database the orchestrator assigns.
- No `.env` file is read or written.
- The mode hides; it never grants (spec D6). No MERL-T server guard changes.
- Data collection and the consent are untouched (spec D4): no change in `features/merlt/tracking/`,
  `features/merlt/consent/`, `GlobalMerltSlot`, `ArticleMerltSlot`.
- Shared code first: `useAuth`, `authService`, `adminService`, `ui/Modal`, `MenuButton` patterns,
  `isMerltEnabled`, `isMerltGraphEnabled`, `useMerltFeatures`, the plugin registry.
- Before calling the PR done: web test, build and lint; the server suite; a browser pass on the
  branch's Vite (:5174) with a test account enabled and one not enabled.

## Task 1: the server (`apps/server`)

**Files:** `prisma/schema.prisma` (`devModeAllowed`, `devMode` on `User`, mapped to
`dev_mode_allowed`, `dev_mode`, default false); `prisma/migrations/20261020100000_user_dev_mode/migration.sql`;
`src/controllers/adminController.ts` (`updateUserSchema.devModeAllowed`; revoking writes
`devMode: false` in the same update; both fields in list, get, create and update responses);
`src/controllers/authController.ts` (`/auth/me` and login carry `dev_mode_allowed`, `dev_mode`; a
new handler for the switch); `src/routes/auth.ts` (`PUT /auth/dev-mode`, authenticated, strict
`{ enabled: boolean }`); tests `tests/devMode.test.ts`.

- [ ] **Step 1: Failing tests**: defaults false; the admin sets `devModeAllowed` and revokes it
  (revoking also writes `dev_mode` false); a non-admin on the admin route → 403; `PUT /auth/dev-mode`
  with `enabled: true` and no permission → 403 and nothing written; with permission → on, then off;
  an extra key (`devModeAllowed`, `dev_mode_allowed`) on `PUT /auth/dev-mode` → 400 and nothing
  written; unauthenticated → 401; `/auth/me` and login carry both fields.
- [ ] **Step 2: Run to see them fail** (`npm --prefix apps/server test -- devMode`).
- [ ] **Step 3: Implement**; the migration by hand.
- [ ] **Step 4: Run the server suite and build.**
- [ ] **Step 5: Commit** — `feat(server): a per-user development mode, enabled by the administrator`.

## Task 2: the web (`apps/web`)

**Files:** `src/types/api.ts` (`dev_mode_allowed?`, `dev_mode?`, `AdminUserUpdate.devModeAllowed?`);
`src/services/authService.ts` (`setDevMode(enabled)`; refresh the shared `/auth/me`);
`src/hooks/useAuth.ts` (`canUseDevMode`, `devMode`; every mounted instance follows a change);
`src/features/devMode/` (`useDevMode`, `DevRoute`, tests); `src/App.tsx` (the MERL-T routes in
`DevRoute`); `src/components/layout/Sidebar.tsx` (spec D1–D3, D8); `src/components/features/search/ArticleTabContent.tsx`,
`SelectionPopup.tsx` and the plugin registry (the D3 surfaces only with the mode; `article_case_law`,
`article_content_after`, `global` unchanged); `src/components/ui/SettingsModal.tsx` («Modalità
sviluppo» for `canUseDevMode`); `src/pages/AdminPage.tsx` (the per-user checkbox); `src/config/tourConfig.ts`
(D9); `apps/web/CLAUDE.md`, `docs/merlt/claude-notes.md`.

- [ ] **Step 1: Failing tests** (spec «Web», Tests).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the web suite; build; lint.**
- [ ] **Step 5: Commit** — `feat(web): a quieter sidebar, and the MERL-T surfaces behind the development mode`.

## PR

Title «feat: a quieter sidebar, and a per-user development mode»; body: the spec's decisions, the
migration, the security conditions (D7) and their tests, the note that data collection and consent
are untouched pending the owner's decisions 123–124. Merge commit
`merge: feat/dev-mode — a quieter sidebar, and Grafo and Assistente behind a per-user development mode`.
