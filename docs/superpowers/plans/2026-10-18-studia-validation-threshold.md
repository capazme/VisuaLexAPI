# Plan: the validation threshold set by an administrator

Spec: `docs/superpowers/specs/2026-10-18-studia-validation-threshold-design.md`.
Two pull requests into `develop`, server first, then web. Each task ends with its suite green
and a review of the diff before the next one starts.

## Server (`feat/studia-soglia-validazione`)

1. **Schema and migration `20261025100000_lingo_settings`.**
   - Prisma: enum `LingoImpostazioneChiave`, models `LingoImpostazione` (`lingo_impostazioni`) and
     `LingoImpostazioneLog` (`lingo_impostazioni_log`), back-relations on `User`. No `prisma format`.
   - SQL by hand: the enum, both tables, the range `CHECK`, the foreign keys (`SET NULL` on user
     deletion), an index on the log, and the two seed rows (2 and 1).
   - Verify: `prisma migrate deploy` on `visualex_test_soglia`, `prisma migrate status`, and a drift
     check (`migrate diff` from the test database to the schema, empty).
2. **`lingo/validationSettings.ts`.**
   - `leggiSoglie(tx)`: reads the two rows, falls back to the defaults when a row is missing (the
     test reset truncates `users` with cascade).
   - `anteprimaSoglie(soglie)` and `applicaSoglie(soglie, utenteId)`: the recompute, in one transaction,
     locking settings then proposed cards by id, with the log rows.
3. **`lingo/validationRule.ts`.** `SOGLIE_PREDEFINITE`, `stateAfterVotes(votes, soglie)`. Update the
   unit test. Grep every use of the two old constants; none may remain outside the defaults.
4. **Vote route.** Read the thresholds after the card lock, pass them to `stateAfterVotes`. Test: a
   vote after a threshold change uses the stored value.
5. **Admin route `routes/adminStudiaSoglie.ts`** on `/api/admin/studia/soglie`, mounted in `app.ts`.
   Zod with `.strict()` and the ranges. Tests: anonymous 401, non-admin 403, ranges refused, preview
   counts, saved values, one log row per changed key, cards already validated or archived untouched,
   a card whose author is gone and that becomes archived is deleted.
6. **Concurrency test.** A vote and a threshold change on the same card, both orders, ends in a state
   consistent with the stored values.
7. **Server suite, build, lint.** `npm --prefix apps/server test`, `npm --prefix apps/server run build`.
8. **Review of the server diff** (code-reviewer agent), fix every finding, then the PR into develop.

## Web (after the server PR is merged)

9. **Service and component.** `adminService` functions for the three routes; `StudiaSoglieAdmin`
   with two number fields, «Salva», the preview sentence, errors in Italian. Mounted above
   `StudiaTextsAdmin` in the admin studia tab. Does not touch `Sidebar.tsx`, `Layout.tsx` or `App.tsx`.
10. **Tests.** Component tests for the preview, the save, the range errors and the non-admin case
    (the tab is admin-only already).
11. **Web suite, `npm --prefix apps/web run build`, lint.**
12. **Browser pass** of the admin tab at 1366 and 390 px, light and dark, with a headless Playwright
    of the worktree's own. Never the Chrome extension, never a personal account.
13. **Review, PR into develop, merge at green CI.**

## Closing

- Written handoff to the orchestrator.
- Drop `visualex_test_soglia`, delete the test admin account, remove the worktree.
