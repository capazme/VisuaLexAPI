# Plan: the Forum's community, server side (A votes, B profile, C communities)

Spec: `docs/superpowers/specs/2026-11-14-forum-community-server-design.md`. Server only; no file of `apps/web`. Part D
waits for the owners' word after the legal reading and is not in this plan.

## How every pull request runs

- Its own worktree and branch from `origin/develop`; one migration, written by hand. B builds on A's answers and C on
  B's profile: while A or B waits for its yes, the next branch starts from the previous one and its pull request
  targets `develop` (CI runs), saying which to merge first.
- Its own `node_modules` in the worktree (`npm ci` in `apps/server`): the generated Prisma client must never be the
  main checkout's, which the running development server uses.
- Tests on a database of its own in the development Postgres (`visualex_test_forum`), created by the test setup's
  reset and dropped at the end of the job; one test file at a time, inside the Mac's one test slot; never the shared
  test database, never the development one, never a stop of the development stack. CI runs the whole suite.
- A failing test first, then the code. `npm --prefix apps/server run build` before the pull request.
- `apps/server/CLAUDE.md` updated in the same pull request; the independent review (`code-reviewer`) before reporting.

## PR A · `feat/forum-votes` (D-248)

1. **Migration `20261114100000_forum_votes_up_down`** and `schema.prisma`: `value` on both vote tables (CHECK), `score`
   on threads and comments, the two trigger functions and triggers, the own votes deleted (glosses, replies and
   comments), `score` filled, index `(is_hidden, score)`. Test first: `tests/forumVotes.test.ts`, the trigger block
   (insert, change, delete, cascade on an account and on an item).
2. **Account deletion** (`lingo/deleteUserAccount.ts`): the person's votes deleted before the account, glosses
   locked by id then their votes, replies and comments locked by id then their votes.
3. **`src/forum/votes.ts`**: `castVote(tx, kind, itemId, userId, value)` (visibility, own, comment rules; upsert or
   delete; the counts read back) and `personalScores(db, userIds)` (two grouped sums over visible items).
4. **Routes**: `PUT …/vote` on threads and comments (`communityController`), the daily counter `vote`
   (`forum/limits.ts`); the old `POST …/vote` rewritten on `castVote` (none → up, up → none, down → up; own 403).
5. **Answers**: `score`, `upvotes`, `downvotes`, `userVote` on every glossa, reply and comment (feed, glossa's page,
   reader's lists); the author's `score`; `popular` and the replies' order by `score`.
6. **Export**: each vote's `value`.
7. Update the existing tests that pinned an own vote or the old order; `CLAUDE.md`.

## PR B · `feat/forum-profiles` (D-246, D-247, D-249)

1. **Migration `20261114100001_forum_profiles`**: `forum_profiles` with its CHECKs (identity and name, the forms, the
   qualification list) and the unique index on `lower(pseudonym)`. Test first: `tests/forumProfiles.test.ts`, the
   CHECKs and the cascade with the account.
2. **`src/forum/profiles.ts`**: the Zod schema (Italian messages, reserved pseudonyms), `readProfile`,
   `authorViews(db, users)` (one query for profiles and scores per answer), `requireWriter(tx, userId, 'glossa' |
   'reply')` under the switch.
3. **Switch** `forum_identity` in `assistant/switches.ts`.
4. **Routes** (`forumProfileController`, mounted with the Community's): `GET` and `PUT /forum/profile` (the `edit`
   counter; the pseudonym refused while any contribution stands under another name, unique against pseudonyms and
   usernames, a new public id when leaving the real name), `GET /forum/profiles/:profileId`.
5. **Writes**: `createThread` and `createComment` call `requireWriter`; a pseudonym profile never writes a glossa.
6. **Answers**: every author object through `authorViews` (feed, glossa's page, reader's lists, the create answers);
   the moderators' queue adds the profile's name.
7. **Export**: the profile. `CLAUDE.md`.

## PR C · `feat/forum-communities` (D-214, D-267)

1. **Migration `20261114100002_forum_communities`**: `forum_subject_roles`, `forum_validations`, `forum_appeals` (the
   partial unique index on a pending appeal), `hidden_at` on threads and comments, `forum_moderation_log.materia`, the
   action, notification kind and notification reply-id CHECKs widened. Test first: `tests/forumCommunities.test.ts`,
   the CHECKs and the cascades.
2. **Roles**: `PUT /admin/users/:id/forum-roles` (owners; reason; real name for a validator, a profile for a
   moderator; logged with the subject); `forum/roles.ts` reads a person's subjects as moderator and validator.
3. **Subject moderation**: `requireModeratorOf(tx, userId, materia)` in every moderation route, the subject read
   after `lockThread`; the queue and the badge filtered by the person's subjects, `materia` on each item, no username
   for a subject's moderator; `getThread`'s moderator view limited to their subjects; `hidden_at` set and cleared.
4. **Validation**: `POST` and `DELETE /forum/validations/:kind/:itemId` (lock order, rules, notification `validated`
   once); `editThread` and `editComment` withdraw an item's validations on a text change, and a glossa's and its
   replies' on a change of subject (`validationsWithdrawn`); B's pseudonym check extended to roles and given
   validations.
5. **Answers**: `validation` on a glossa and its replies, the replies' order (validated, accepted, score, oldest), the
   feed's `validated`, `validatedReplies` and filter; `GET /forum/communities`; the profile's `roles`,
   `validatedCount` and `GET /forum/profiles/:profileId/validated`.
6. **Appeals**: `POST /forum/appeals` (one per hiding, the `report` counter), `GET /moderation/appeals`,
   `POST /moderation/appeals/:id/decide` (owners; uphold shows the item again and logs `unhide`, reject logs
   `appeal_rejected`; notification `appeal`); showing an item closes its pending appeal; the author's deletion removes
   its appeals; the hidden notice's `appeal`.
7. **Export**: roles, given validations, appeals, without who appointed or decided. `CLAUDE.md`.

## After each pull request

The report to the orchestrator: its number, what changes in two lines, what an owner might choose differently, what
was left out. No merge: each pull request waits for the owner's yes.
