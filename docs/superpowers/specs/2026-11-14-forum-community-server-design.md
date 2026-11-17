# The Forum's community, server side: votes, profile, communities by subject

Status: approved by the owner on 14 November 2026 with the choices listed below (G-476), and his answers folded in:
one public identity (G-477), a number of validations as Learn's cards, never a gate on what is shown (G-478), the
real name declared with a report «non è chi dice di essere» checked by the owners (G-479), the Forum's own validators
per subject (G-489), off-topic kept as a reason to hide (G-490); the legal reading of part D is the owner's (G-480). Server only (`apps/server`): no file of `apps/web`. It gives the Forum's page
(`/forum/community`) a finished API to be built against. Plan:
`docs/superpowers/plans/2026-11-14-forum-community-server.md`.

It rests on the owners' decisions D-214 (the best of Reddit and of LinkedIn: communities by subject, votes that bring
useful answers up, threaded discussions, a real professional identity, a profile that gathers reputation), D-246 (real
name for whoever signs glosses and for validators; a pseudonym in discussions, with the declared qualification
visible), D-247 (the qualification is declared, never checked), D-248 (up and down votes, a public personal score),
D-249 (minimal profile: name or pseudonym, qualification, subjects, validated contributions), D-267 (below 20 members
the owners moderate; then moderators, with appeal to the owners; suspension is always the owners'), D-268 and D-320
(removed content is deleted with no trace, its moderation log row included), D-180 (the Forum is never paid for).

## What is already there

Since #383 and #384 (spec `2026-10-20-forum-community-glosse-design`, closed with #223; `apps/server/CLAUDE.md`, «The
Forum's Community»): a glossa is an `ArticleThread`, its discussion its `ArticleComment`s at two levels (replies, and
comments under a reply). The feed, a glossa's page, edit and delete by the author, the accepted reply chosen by the
glossa's author, reports, moderation that **hides and logs** (`forum_moderation_log`), notifications, daily limits,
contributions that outlive the account («utente cancellato»). Votes are one «up» per person per item, toggled
(`POST …/vote`); new votes on a comment (second level) are refused. Moderators are `users.forum_moderator` or admins,
for the whole Community. Every route is behind the login and none is reachable by a connected application.

The reader's panel (`ArticleDiscussionPanel`, in the article and the decision readers) uses the same routes and stays
working through every part below: its fields stay in the answers (marked «legacy» here), and what a part makes
stricter is said where it does.

## Rules for every part

- One migration per pull request, written by hand, additive where possible, applied with `prisma migrate deploy`.
- Answers in Italian through `parseItalian` (`{ detail }` on a 4xx); a missing or invisible item is a 404.
- Every write that adds under a glossa or decides about what hangs on it locks the glossa, then the reply
  (`forum/locks.ts`), in that order, as today.
- Each new write goes under a daily counter (`forum/limits.ts`); a refused write gives its point back.
- `GET /auth/export` carries what each part adds about the person; deleting the account takes it with the account
  unless said otherwise.
- `apps/server/CLAUDE.md` is updated in the same pull request.

## A · Votes up and down, and the personal score (D-248)

### Data (migration `forum_votes_up_down`)

- `article_thread_votes.value` and `article_comment_votes.value`: `SMALLINT NOT NULL DEFAULT 1`, CHECK `value IN (-1,
  1)`. Every stored vote is an up vote today, so nothing is rewritten.
- `article_threads.score` and `article_comments.score`: `INTEGER NOT NULL DEFAULT 0`, the sum of the item's votes,
  kept by an `AFTER … FOR EACH ROW` trigger on every insert, change and deletion of a vote (deletions by cascade
  included: an account deleted, an item deleted, where it updates no row). The trigger, not the routes, because votes
  also go by cascade, where no route runs. It never touches `updated_at` (Prisma writes that). Filled once from the
  stored votes (`SET score = SUM(value)`). Index `(is_hidden, score)` for the feed.
- The stored votes on one's own glossa, reply or comment are deleted (they would count in one's own public score).
- **Deleting an account** first deletes the person's votes in the lock order (`lingo/deleteUserAccount.ts`): the
  glosses they voted, locked by id, then those votes; the replies and comments they voted, locked by id, then those
  votes; then the account. Left to the cascade, the trigger would lock others' rows in any order, a reply before its
  glossa, against a reply being written that holds the glossa and waits for the reply: a deadlock.

### Rules

- Any logged-in person votes on a **visible** glossa or reply (not hidden, not emptied, its glossa not hidden). Not a
  comment: a comment is a remark; its old votes stay counted and may be withdrawn (`value: 0`), nothing else (as
  today).
- One vote per person per item: up (+1) or down (−1). Voting again with the other value changes it; `0` withdraws it.
  No reason is asked for a down vote (D-248 chose Reddit's two buttons).
- **Never on one's own contribution**: 403 «Non puoi votare un tuo contributo». This now holds on the old toggle too:
  the reader's panel, which still shows the button on one's own glossa, answers that click with its generic error
  until the web hides it.
- A locked glossa can still be voted: the lock closes it to new replies, not to judgement.
- Daily counter `vote`, `FORUM_DAILY_VOTES` (default 300).
- **The personal score** of a person is the sum of `score` over their visible glosses, replies and comments. Hidden or
  emptied contributions stop counting while they are so, and so do the replies and comments under a hidden glossa; a
  contribution whose author's account is gone counts for nobody. The votes a person cast go with their account (as today), and the scores they gave go with them.

### Routes

`PUT /api/article-discussions/:threadId/vote` and `PUT /api/article-discussion-comments/:commentId/vote`:

```json
// request
{ "value": -1 }            // 1 up, -1 down, 0 withdraw
// 200
{ "value": -1, "score": 3, "upvotes": 5, "downvotes": 2 }
```

Errors: 400 `value` not one of 1, −1, 0 («Il voto deve essere 1, -1 o 0»); 400 any value but 0 on a comment («Si vota
una risposta, non un commento»); 403 one's own; 404 missing or not visible; 429 the daily counter.

The old `POST …/vote` stays for the reader's panel, as a toggle of the up vote: none → up, up → none, down → up. Its
answer stays `{ voted, voteCount }` (`voteCount` = up votes).

### What changes in existing answers

- Every glossa, reply and comment in the Community's answers (feed, a glossa's page) and in the reader's lists gains
  `score`, `upvotes`, `downvotes` and `userVote` (1, −1 or 0, the reader's own). `voteCount` (= `upvotes`) and
  `userVoted` (= `userVote === 1`) stay, legacy.
- Every author object in the Community's answers and in the reader's lists gains `score`, the author's personal score
  (`null` for an emptied item or a deleted account): `"user": { "id": "…", "username": "mrossi", "score": 41 }`.
- Order: the feed's `sort=popular` and the reader's `popular` by `score`, then newest; a glossa's replies: the accepted
  reply first, then by `score`, then the oldest (C puts the validated ones above).
- `GET /auth/export`: each vote with its `value`.

### Tests

`tests/forumVotes.test.ts`: the trigger (insert, change, withdraw, cascade on an account and on an item); the account's
votes deleted in order; up, down, change, withdraw; own 403 on both routes; a comment's 1 or −1 400 and its withdrawal
200; hidden and emptied 404; the personal score (hidden, emptied, under a hidden glossa and anonymous left out); `popular` and the replies' order by score; the
legacy toggle's three transitions; the export's `value`. The existing discussion and Community tests updated where an
answer gained fields or an own vote was allowed.

## B · The minimal profile (D-246, D-247, D-249)

### Data (migration `forum_profiles`)

`forum_profiles`, one row per person who has a profile, deleted with the account:

| Column | |
| --- | --- |
| `id` | the person's **public id in the Forum**, never the account's id; renewed when the profile moves to a pseudonym |
| `user_id` | unique, `ON DELETE CASCADE` |
| `identity` | `real_name` or `pseudonym` (CHECK) |
| `real_name` | 3–80 characters, letters, spaces, `'`, `-`, `.`; only with `real_name` |
| `pseudonym` | 3–30 characters, letters, digits, `.`, `_`, `-`; only with `pseudonym`; unique without regard to case |
| `qualification` | closed list (CHECK): `avvocato`, `praticante`, `magistrato`, `notaio`, `docente`, `dottore` (laureato in giurisprudenza), `studente`, `altro` |
| `materie` | the subjects the person follows: a set of the five `LingoMateria` values, possibly empty |
| `name_withdrawn_at`, `name_withdrawn_reason` | set together by the owners when they confirm a report «non è chi dice di essere» (G-479), cleared when they give the name back |
| `created_at`, `updated_at` | |

A CHECK makes the name match the identity: a real name and no pseudonym, or the reverse. **One public identity per
person** (G-477): the profile is under the real name or under a pseudonym, never both, so nothing on the server ever
links the two. The qualification is declared and shown as declared (D-247), and so is the real name (G-479): no field
records a check. A name withdrawn by the owners (below) is `name_withdrawn_at` on the profile.

App switch `forum_identity` (`assistant/switches.ts`, off at the start): **off**, writing needs no profile, as today;
**on**, a glossa needs a profile under the real name and a reply or a comment needs a profile. The web turns it on
when it shows the profile page; the reader's panel keeps working meanwhile.

### Where the real name is required and where a pseudonym is enough

| Act | Off | On |
| --- | --- | --- |
| Write a glossa (it is signed, D-246) | no profile, or one under the real name; under a pseudonym, 403 | profile under the real name, else 403 «Per firmare una glossa serve il profilo con il nome vero» |
| Write a reply or a comment | no profile needed | any profile, else 403 «Per scrivere nel Forum completa il profilo: nome o pseudonimo e qualifica» |
| Vote, report | no profile needed | no profile needed |
| Validate (C), be appointed validator (C) | profile under the real name | the same |

**Taking a pseudonym never relabels what others have already read under another name.** A profile under a pseudonym
(a new one, or a change from the real name) is refused, 409 «Hai contributi pubblicati con un altro nome: cancellali
prima di usare uno pseudonimo», while the person has any glossa, reply or comment that is not emptied, hidden ones
included, written under their real name or, without a profile, their username; from C on also while they hold a
validator's role or have given validations, which are signed with the real name (D-246). Moving from the real name to
a pseudonym also gives the profile a **new public id**, so a link saved before leads nowhere. Moving from a pseudonym
to the real name is allowed and keeps the id: it is a revelation the person chooses, and every past reply then shows
the real name (the web says so first, `contributions` below). Changing one pseudonym for another keeps the id.

### Routes

`GET /api/forum/profile` (one's own):

```json
{
  "profile": { "id": "f0c2…", "identity": "real_name", "realName": "Maria Bianchi", "pseudonym": null,
               "qualification": "avvocato", "materie": ["DIRITTO_CIVILE"], "updatedAt": "2026-11-15T09:12:00.000Z" },
  "required": true,          // the switch
  "canWrite": true,          // may write a reply or a comment now
  "canSign": true,           // may write a glossa now
  "score": 41,
  "contributions": { "glosse": 2, "risposte": 9 }   // not emptied, hidden ones included (replies and comments):
                                                    // what a change of name reaches, for the web's warning
}
```

`profile` is `null` without one. `PUT /api/forum/profile` creates or replaces it and answers as `GET`:

```json
{ "identity": "pseudonym", "pseudonym": "civilista42", "qualification": "praticante", "materie": ["DIRITTO_CIVILE"] }
```

Errors: 400 a field out of its form or list (each with its Italian message); 409 a pseudonym already in use, as another
profile's pseudonym or another account's username, without regard to case («Questo pseudonimo è già usato»); 409 a
pseudonym refused as above; 429 the `edit` counter. A few pseudonyms are reserved (`utente_cancellato`,
`utente.cancellato`, `moderatore`, `amministratore`, `admin`, the products' names). While the switch is off, an
account registered later may still take a username equal to a pseudonym: with the switch on, usernames show only on
what was written before it.

`GET /api/forum/profiles/:profileId` (any logged-in person):

```json
{ "id": "f0c2…", "name": "Maria Bianchi", "identity": "real_name", "qualification": "avvocato",
  "materie": ["DIRITTO_CIVILE"], "score": 41 }
```

C adds `roles` and `validatedCount`. **A public profile never shows**: the email, the account's username or id, a
real name behind a pseudonym (none is stored), the votes cast, the reports made, hidden or emptied contributions, the
moderation's acts about the person, the last login, anything outside the Forum. 404 for a profile that does not exist.

**«Non è chi dice di essere»** (G-479). `POST /api/forum/profiles/:profileId/report` `{ "details": "…" }` (0–1,000
characters; any logged-in person, never on one's own profile, one pending report per person per profile, under the
`report` counter) → 204. The report goes to the owners alone, in `forum_profile_reports` (the profile by a plain id,
the reporter SET NULL with their account, `details`, `status` `pending` | `confirmed` | `dismissed`, who closed it and
when, the reason): `GET /api/moderation/profile-reports?status=` (owners; pages of 1–50; the profile as the public sees
it and, for the owners only, the account's username and email to check it) and `POST
/api/moderation/profile-reports/:profileId/resolve` `{ "action": "confirm" | "dismiss", "reason": "…" }` (owners; the
reason 3–1,000 characters; one decision closes every pending report of the profile; logged). **Confirming withdraws
the name**: `name_withdrawn_at` is set, every view shows the profile as «nome ritirato» (`identity: "withdrawn"`, no
qualification), the person can neither write nor change the profile (403 «Il nome del tuo profilo è stato ritirato
dai responsabili del Forum») until the owners give it back (`POST /api/moderation/profile-reports/:profileId/restore
{ reason }`, logged). The person reads it, with the owners' reason, on their own profile (`GET /api/forum/profile` →
`nameWithdrawn: { "at": "…", "reason": "…" }`, else `null`). The reporters are never named to the person reported.
The log gains the actions `withdraw_name` and `restore_name` on the target kind `profile`.

### What changes in existing answers

Every author object in the Community's answers and in the reader's lists becomes:

```json
"user": { "id": "f0c2…", "name": "civilista42", "identity": "pseudonym", "qualification": "praticante",
          "score": 41, "username": "civilista42" }
```

- `id` is the profile's public id (`null` without a profile), so the Community no longer carries the account's id,
  which other parts of the app (the Forum's published dossiers) show next to the account's username: a pseudonym could
  otherwise be matched to it.
- `identity` is `real_name`, `pseudonym`, `username` (no profile: the account's username, as today), `withdrawn`
  («nome ritirato», G-479) or `deleted` («utente cancellato»). An emptied item keeps `name: ""` and nulls, as today.
- `username` (= `name`) stays, legacy, for the reader's panel.
- The moderators' queue adds the profile's name; the account's username stays there for the owners and the
  Community's moderators only (C: never for a subject's moderators).
- `GET /auth/export`: the profile.

### Tests

`tests/forumProfiles.test.ts`: create, change, each field's limits; the pseudonym unique without regard to case
(against pseudonyms and usernames) and reserved words; the pseudonym refused while any contribution, hidden included,
stands under another name, allowed once they are emptied, with a new public id; from a pseudonym to the real name, the
same id; the switch off and on, for a glossa and a reply; the
public profile's fields and nothing more (no email, username, account id); the author objects in the feed, a glossa's
page and the reader's lists; the report «non è chi dice di essere» (not one's own, one pending, owners only, confirm
withdraws the name everywhere and stops writing, restore gives it back, the person told, the reporters not named); the
profile deleted with the account; the export.

## C · Communities by subject, moderators and validators, the validated answer on top (D-214, D-267)

### Data (migration `forum_communities`)

- **A community is a subject**: one of the five `LingoMateria` values Learn already uses; a glossa's `materia`
  (chosen by its author, already stored) places it. A glossa without a subject is in the Forum but in no community.
- `forum_subject_roles (user_id, materia, role)`: `role` `moderator` or `validator` (CHECK), `appointed_by` (SET NULL),
  `created_at`; primary key on the three; deleted with the account.
- `forum_validations`: one row per validator per glossa or reply (`thread_id` or `comment_id`, exactly one, each
  `ON DELETE CASCADE`), `validator_id` (`ON DELETE SET NULL`: the validation outlives the validator's account and
  still counts, shown as «utente cancellato»), the `materia` it was given in, `created_at`; unique on (item,
  validator).
- `hidden_at` on `article_threads` and `article_comments` (nullable): when the item was last hidden, cleared when it is
  shown again; an appeal belongs to that hiding.
- `forum_appeals`: the author's appeal against a hiding (`user_id` CASCADE, `target_kind`, `target_id` plain as the
  reports', `text` 3–2,000 characters, `status` `pending` | `upheld` | `rejected`, `decided_by` SET NULL,
  `decided_at`, `decision_note`); at most one pending per item (a partial unique index).
- `forum_moderation_log.materia` (nullable): the subject of an appointment. New actions: `appoint_validator`,
  `revoke_validator`, `appeal_rejected` (its target the item, `thread` or `comment`). New notification kinds
  `validated` and `appeal`, and the CHECK that asks a notification for a reply's id widened to them: a glossa's
  validation or appeal names no reply.

### Who moderates what

Moderators are there to remove harmful, violent or vulgar content (G-478), never an opinion or its quality: that is
what votes and validation judge.

- **The owners** (admins): everything, as today; the only ones who appoint and revoke, decide appeals and empty an
  anonymous contribution. Suspension stays theirs (D-267) and is not built here.
- **The Community's moderators** (`users.forum_moderator`, appointed by the owners, today's): the whole Community, as
  today.
- **A subject's moderators**: the same acts (the reports' queue, hide and show, lock and unlock, resolve) on the glosses
  of their subject and what hangs on them, nothing else; their queue and badge hold only those, and a glossa's page
  shows them hidden items only in their subject. A glossa moved to another subject by its author moves with it: each
  moderation route reads the subject after locking the glossa. The queue never shows them the account's username,
  only the public name and the profile's id.
- D-267's threshold is the owners' judgement: the server does not count members before an appointment. The
  communities' route shows `members` (profiles that follow the subject) so they can see it.
- An author whose contribution was hidden may **appeal to the owners once per hiding**: while it is hidden and no
  appeal of theirs was made since it was last hidden (`hidden_at`). The owners uphold it (the contribution is shown
  again, logged as `unhide`) or reject it (logged as `appeal_rejected`), with a reason of 3–1,000 characters; the
  author is told either way. Showing the item again by any route closes its pending appeal as upheld; the author's
  deletion of the item deletes its appeals.

### Validation and the order of a thread

- A **validator of the glossa's subject**, under the real name (D-246), validates a visible glossa or reply of someone
  else; not a comment; not a glossa without a subject (409 «La glossa non ha una materia: non si può validare»).
- **A number of validations** makes an item «validata», as for Learn's cards (G-478): the threshold is a setting the
  owners change at runtime, in Learn's settings table and its log (`lingo_impostazioni`, a new key
  `FORUM_SOGLIA_VALIDAZIONI`, 1–5, 2 by default as Learn's approvals), never an environment variable. Below the
  threshold an item shows its validations so far (`count`, `threshold`), not «validata»; a change of the threshold
  applies at once to every item, nothing is stored per item. Only approvals: there is no «errata» vote in the Forum.
  Every validation names its validator (while the validator's account exists) and is shown. The validator withdraws
  their own at any time.
- **Validation never decides what is shown** (G-478): every opinion is published and stays visible, validated or not;
  validation is an added mark of quality, which only moves validated replies up in a glossa's order.
- **Editing the text** of a validated glossa or reply withdraws its validations (what was validated is no longer
  there); **changing a glossa's subject** withdraws its validations and its replies' (they were given with another
  subject's authority). The edit's answer says how many (`validationsWithdrawn`).
- Revoking a validator's role leaves the validations they gave (given with the authority they had then).
- The author is told once that an item was validated.
- **Order of a glossa's replies**: the validated replies (at the threshold) first, more validations first, then the
  earliest to reach it; then the accepted reply; then by `score`; then the oldest. Comments under a reply stay oldest
  first.

### Routes

`GET /api/forum/communities`:

```json
{
  "data": [
    { "materia": "DIRITTO_CIVILE", "glosse": 12, "members": 7,
      "moderators": [ { "id": "…", "name": "…", "identity": "real_name", "qualification": "avvocato", "score": 40 } ],
      "validators": [ { "id": "…", "name": "Maria Bianchi", "identity": "real_name", "qualification": "avvocato", "score": 41 } ] }
  ],
  "withoutSubject": { "glosse": 4 }
}
```

Any logged-in person. `glosse` counts the listed ones (as the feed). A community's own list is the feed with
`materia=`.

`POST /api/forum/validations/:kind/:itemId` (`kind` `thread` | `comment`) validates; `DELETE` on the same path
withdraws one's own. Both answer the item's validation:

```json
{ "validation": { "count": 1, "threshold": 2, "validated": false, "validatedAt": null,
                  "validators": [ { "id": "f0c2…", "name": "Maria Bianchi", "identity": "real_name", "qualification": "avvocato", "score": 41 } ] } }
```

(`validatedAt` is when the item reached the threshold in force, from the validations' times.) The owners read and
change the threshold with `GET|PUT /api/admin/forum/validation-threshold` (`{ "threshold": 2 }`, 1–5); it is stored
under a new key of Learn's settings table, and each change goes in that table's log.

(`validation: null` once none is left; a validator whose account is gone appears as `{ "id": null, "name": "utente
cancellato", "identity": "deleted", … }`.) Errors: 403 not a validator of the subject («Solo i validatori di questa
materia possono validare»); 403 one's own («Non puoi validare un tuo contributo»); 403 without a real-name profile;
400 a comment; 404 missing or not visible; 404 a withdrawal without one's own validation; 409 no subject; 429 the
`edit` counter. Validating again what one already validated answers 200 unchanged.

`PUT /api/admin/users/:id/forum-roles` (owners):

```json
{ "materia": "DIRITTO_CIVILE", "role": "validator", "granted": true, "reason": "Nucleo dei validatori" }
// 200
{ "roles": [ { "materia": "DIRITTO_CIVILE", "role": "validator" } ] }
```

A validator needs a profile under the real name, a moderator any profile (409 otherwise); the reason (3–1,000
characters) is required, 400 without it, and logged with the subject; 403 for anyone but the owners; 404 an unknown
person; granting a role already held or revoking one not held answers 200 unchanged and logs nothing.

`POST /api/forum/appeals` (the author, under the `report` counter): `{ "kind": "comment", "itemId": "…", "text": "…" }`
→ 201 `{ "id": "…", "status": "pending" }`; 404 not one's own hidden item; 409 an appeal already made for this hiding.
`GET /api/moderation/appeals?status=` (owners; pages of 1–50): each appeal with the item's text, its category, the
subject, the hiding's logged reason. `POST /api/moderation/appeals/:id/decide` (owners): `{ "action": "uphold" |
"reject", "reason": "…" }` → 200 `{ "status": "upheld" }`; 400 without a reason; 403 anyone but the owners; 404
unknown; 409 already closed.

### What changes in existing answers

- A glossa and each reply carry `validation` (as above, or `null` with no validation); a feed item carries `validated`
  (the glossa at the threshold) and `validatedReplies` (how many of its visible replies are). The feed takes
  `validated=true|false`: the glossa or one of its replies at the threshold, or neither. Nothing else in the feed or on
  a glossa's page depends on validation (G-478).
- The hidden item's notice to its author gains `appeal`: `null`, `pending` or `rejected`.
- `GET /api/forum/profile` gains `roles`; the public profile gains `roles` (public: validators and moderators are
  named, P-012) and `validatedCount`; `GET /api/forum/profiles/:profileId/validated?page=&limit=` (any logged-in
  person; pages of 1–50; 404 an unknown profile) lists the person's visible validated contributions (kind, glossa's
  title and anchor, subject, `validatedAt`, `count`), newest first.
- `GET /api/moderation/reports`: each item gains `materia`; a subject's moderator sees only theirs. The Forum's badge
  counts their `pendingReports` the same way.
- `GET /auth/export`: the person's roles, the validations they gave, their appeals; never who appointed them or who
  decided an appeal (other people's ids, as the export already drops who locked a glossa).

### Tests

`tests/forumCommunities.test.ts`: appointments (owners only, reason required, real name for a validator, logged with
the subject); a subject's moderator acting on their subject and refused on another and on a glossa without one;
their queue (no username) and badge; a glossa's page showing them hidden items in their subject only; validate,
withdraw, own, comment, no subject, pseudonym profile, not a validator; the threshold (below it nothing is
«validata», at it the item is, a change applies at once, nothing hidden or held back below it); the text edit and the change of subject that
withdraw; the replies' order; the feed's `validated`; the communities' counts; appeals (one per hiding, a new one
after a new hiding, uphold shows the item again, showing it closes the appeal, the author's deletion removes it,
owners only, the author told); the profile's `roles`, `validatedCount` and
list; the export.

## D · Deletion without trace (D-268, D-320): not built until the owner's legal reading

The owner does the legal reading on the six questions below (G-480). Until then the server hides and logs, and it
stays so. This section says what deletion would remove and asks what the law
may require; it concludes nothing.

### What «deleted with no trace» would remove

For a removed glossa or reply: its row (text, anchor, quotation), and with it its votes, validations, notifications
and the accepted mark; the reports about it (each keeps a copy of the text, today for 90 days after it is closed,
G-308) and the reporters' reasons; the appeals about it; every `forum_moderation_log` row about it (who decided, when,
the category, the reason). Nothing in the database would then show that the item existed, that someone reported it,
or that a moderator removed it. What stays outside the server's reach: the database backups until they rotate
(`scripts/backup.sh`), copies others made under the licence (CC BY-SA), the author's own exports.

Design points the owners decide with the reading: whether a removed glossa takes the others' replies under it with it
(today an author's deletion empties it and keeps them); whether the author is told why, and how, once nothing is kept;
whether appeals (C) survive a deletion.

### Questions for the legal reading

1. **Reasons to the author.** If VisuaLex is a hosting service under Regulation (EU) 2022/2065 (the DSA), does art. 17
   require a statement of reasons to the author of removed content, and can the platform show it gave one if nothing
   of the decision is kept?
2. **Complaints.** Does art. 20 (internal complaint handling, for at least six months after the decision) apply to
   VisuaLex, or does art. 19 exempt it as a micro or small enterprise? If it applies, can a complaint be handled about
   a decision of which nothing is kept?
3. **Notices.** Under art. 16, must the person who reported be told of the decision, and must the notice be kept?
4. **Authorities.** If an authority later asks for removed content or for who wrote it (orders under arts. 9 and 10,
   or a criminal proceeding, for example for defamation), does deleting the content and its record expose the
   association? Is there a duty to keep, or to report (art. 18), content that suggests an offence?
5. **Personal data.** Does keeping a minimal record (who decided, when, the category, without the text) need a legal
   basis and a period of its own under the GDPR (accountability, art. 5(2); the defence of legal claims, art.
   17(3)(e)), and would it be compatible with D-320?
6. **The copy in reports.** Under D-268, does the copy of the reported text (kept today for 90 days, G-308) go at once?

## The owners' answers (14 November 2026)

- **Q1, one public identity per person** (G-477): the real name or a pseudonym, as recommended. B builds it.
- **Q2 and Q3, validation** (G-478): **a number of validations, as Learn's cards**, not one; validation never stops a
  publication nor hides anything, every opinion is accepted, and it is an added, optional proof of quality; moderators
  are there to remove harmful, violent or vulgar content. C builds a threshold the owners set (default 2).
- **Who validates** (G-489): the Forum's validators, appointed by the owners per subject, as the spec proposed; not
  Learn's validators.
- **The real name** (G-479): declared, with a report «non è chi dice di essere» that the owners check. B builds it.
- **Q4, off-topic** (G-490): `fuori_tema` **stays a hiding category** as well as a report reason, as it is today
  (option (b), not the one recommended). The closed list (`forum/reportReasons.ts`, a CHECK) does not change:
  `offensivo`, `dati_personali`, `spam`, `fuori_tema`, `diritti`, `altro`.

## Choices the owner approved (G-476)

- The old vote toggle refuses one's own vote at once (403 with the code `own_contribution`), and the stored own votes
  are deleted.
- The votes cast by a deleted account go with it (today's behaviour), lowering the scores they gave.
- A locked glossa can still be voted.
- The qualification list (eight values with `altro`): a change is a migration.
- A pseudonym only for whoever has nothing standing under another name: an existing writer empties their
  contributions first.
- The validated replies above the accepted one; an edit withdraws the validations instead of being refused; a revoked
  validator's validations stay.
- Appeals reach the owners only, one per hiding; a change of a glossa's subject withdraws its validations.
- Writing behind a profile only when the switch `forum_identity` is on.

## Left out

- Part D, until the owner's word after the legal reading (G-480).
- The Forum's suspension of a person (D-267: the owners'): today an admin can only deactivate an account.
- Each community's written rules, flair on posts, following people: not decided.
- Glosses at the margin of the article (item 33 of the web plan): two switches already in place, nothing to build here.
- The Forum's published dossiers keep showing the account's username: pseudonyms hold in the Community.
