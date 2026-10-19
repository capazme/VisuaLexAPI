# The Forum's Community: discussion on someone's glossa

20 October 2026. Status: **proposal**, to be read by both owners before any code (G-304). Target release: 1.10.
Builds on the draft pull request #205 (`feat/glosse-forum`, spec `2026-10-19-glosse-forum-design.md`) and on the
decisions G-265, G-266, G-283, G-291, G-292, G-293. The owner's answers to this design's questions (G-306 to G-312,
20 October 2026) are folded in; G-309 to G-312 also wait for the other developer's word (§11).

## 1. What was decided, and what it means

The owner, asked whether the Community is a model of its own (posts and threads, Reddit-style) or grows from the glosse
of #205: «sì la community fa discussione sulla glossa di qualcuno» (G-304).

So the Community is **not a second forum with posts of its own**. Every discussion starts from a glossa — a public
comment someone wrote on an article or a decision, anchored on it, possibly on one passage — and the Community is where
the other users answer it, argue with it, vote, and where the glossa's author marks the answer that settled the
question. The glossa is the post; the discussion is what grows under it.

This has three consequences that shape everything below:

1. **No new «post» entity.** The glossa already exists (`ArticleThread`, the cloud icon in the reader, with replies,
   votes and reports). The Community reuses it and its replies (`ArticleComment`). What is new is around them:
   accepted answer, editing and deletion, moderation by moderators, reports on replies, notifications, a page.
2. **A discussion always has a subject in the law.** Every glossa has an anchor (an article, a decision, optionally a
   passage). There is no free-floating question «tra colleghi» without a norm or a decision; that is the deliberate
   price of G-304, confirmed for the first cut (G-311).
3. **The reader and the Community are one conversation seen from two places.** A reply written in the Community shows
   in the reader's discussion panel and the reverse. Nothing is copied.

The other developer's earlier idea (19 October: a post with a dossier attached, the debate turned by AI into glosse
that the participants validate) is **not** in this design. It is compatible with it as a later step (§9) and needs
decisions this spec does not take (§11).

### Words

| In the interface | In the code | What it is |
| --- | --- | --- |
| glossa | `ArticleThread` | a public comment on an article or a decision, by one author |
| risposta | top-level `ArticleComment` (`parentId` null) | an answer to the glossa; may be accepted |
| commento | nested `ArticleComment` | a remark under a reply |
| discussione | a glossa with its replies | what the Community lists |
| risposta accettata | `article_threads.accepted_comment_id` | the reply the glossa's author marked as the one that settled it |

## 2. Goals, non-goals, anti-goals

**Goals**
- A lawyer reading an article sees that colleagues discussed a passage, opens the discussion, answers it with a
  reasoned reply that may cite norms and decisions, and the glossa's author can say which answer settled it.
- The Community page shows what is being discussed now, by article or act, by court, by subject.
- The two owners and the moderators they appoint (G-266) can see what was reported, hide what breaks the rules,
  and every such act is on record with its reason.
- The glossa's author learns that someone answered.

**Non-goals (first cut)**
- Free questions without a norm or a decision.
- AI on discussions (summaries, glosse drawn from a debate, answers by Claude through MCP).
- Anonymous readers or search engines: everything stays behind the login (ADR-001).
- Direct messages, mentions, following people, e-mail notifications, downvotes, reputation shown on profiles
  (points and levels are G-303's spec).

**Anti-goals: it fails even if it works when**
- someone's words outlive their own deletion of them (§4.4), or outlive their account without their having been told
  so beforehand (§7.3);
- a moderator acts with no trace, or a glossa's author can silence the replies that disagree with them (§5);
- a decision's withdrawn quotation leaks through the Community (G-291, §4.6);
- the reader's anchors move or vanish because of anything the Community does (root rule 23: the Community never
  writes an article's or a decision's text, and never rewrites a stored passage).

## 3. What exists, and what #205 adds

Today (`develop`): `ArticleThread` (anchor, optional passage, title, body, author, `isHidden`), `ArticleComment`
(`parentId`, depth limited to three levels, `isHidden`), toggled up-votes on both, `ArticleThreadReport` (one per user
and glossa, written and **never read by any route or screen**), `PATCH /admin/article-discussions/:id` (admins:
`hidden`, `passageReleased`). No editing, no deletion by the author, no reports on replies, no notifications. Every
route is behind `authenticate`; accounts are created by registration **approved by an admin** (`isActive: false` until
then), so writing is already open only to people the owners let in.

#205 (draft; G-293: merge after the browser pass and the other developer's ok) adds `GET /article-discussions/feed` (every visible
glossa; sorts `recent|popular|active|unanswered`; filters `kind`, `act`, `normaKey`, `court`, `mine`), `GET
/article-discussions/:threadId` (one glossa with its visible replies), the server-side withholding of a decision's
quotation outside the reader (G-291), the composer's notice that a glossa is public, and an unstyled «Glosse» tab.

**What #205 must change before it merges: nothing in its server routes.** This design extends them (new fields and
filters) without changing what they already answer. Where its tab lives is the other developer's call (G-309, §6.1).
#205 puts «Glosse» inside «Dossier pubblici»; under this design the glosse feed *is* the Community page, so the tab
belongs at `/forum/community`, replacing F1's placeholder. If #205 merges first as it is, the move is part of this
design's web work.

## 4. The model

### 4.1 Entities and changes (one migration, §9)

`article_threads` (the glossa) gains:
- `accepted_comment_id` — nullable, FK to `article_comments`, `ON DELETE SET NULL` (the column #205 designed, G-292).
- `edited_at` — set when the author edits title or body; null otherwise.
- `deleted_at` — set when the author deletes a glossa that others answered (§4.4).
- `locked_at`, `locked_by` — a moderator closed it to new replies (`locked_by` FK to `users`, `SET NULL`).
- `materia` — nullable `LingoMateria` (the five subjects of Gymnasium), the author's choice (§6.2).
- `user_id` becomes **nullable**, `ON DELETE SET NULL` instead of `CASCADE` (G-307, §7.3).
- indexes `(is_hidden, created_at)` and `(is_hidden, updated_at)` for the feed (#205's decision 3).

On both `article_threads` and `article_comments`:
- `hidden_reason` — the closed category of §5.2 a moderator chose when hiding; null when visible.
- `licence_text_id` — FK to the versioned text the author accepted when writing it (§7.2), `RESTRICT`; null for what
  was written before the text existed.

`article_comments` (replies and comments) gains `edited_at`, `deleted_at`, and the same nullable `user_id`
(`SET NULL`, G-307).

New tables:
- `article_comment_reports` — as `article_thread_reports` (one per user and reply, `reason`, `details`, `status`), plus
  on both report tables `resolved_by` (FK `users`, `SET NULL`), `resolved_at`, `resolution_note` and `reported_text`
  (G-308, §5.2). On both, the item's foreign key becomes nullable with `SET NULL`, so a report outlives the item it
  copied; the reporter's `user_id` becomes nullable with `SET NULL` too, so a pending report outlives its reporter's
  account *(my call: it is the moderators' evidence)*.
- `forum_notifications` — `user_id` (the recipient, cascade), `kind`, `thread_id`, `comment_id` (both cascade),
  `created_at`, `read_at`. No actor column: the reply names its author already; a notification whose reply is
  deleted goes with it.
- `forum_moderation_log` — append-only: `actor_id` (`SET NULL`), `action`, `target_kind`
  (`thread|comment|report|user`), `target_id`, `reason` (required, 3–1000 characters), `created_at`.

`users` gains `forum_moderator` (boolean, default false), set like `lingoValidatore`.

### 4.2 Replies and comments

- A **risposta** is a top-level reply; a **commento** sits under a reply. New writes are limited to **two levels**
  (reply, comment under it): the server answers 400 «Si può commentare una risposta, non un commento» to a `parentId`
  that is itself a comment. Replies already stored at the third level stay and are shown under their reply, flattened.
  *(My call: the accepted answer needs a clear unit, and a third level is where a Stack Overflow–style page turns into a
  chat. Overturnable.)*
- **Data already stored stays as it is** *(my call)*: third-level replies are shown flattened; votes on comments and on
  one's own content stay counted but no new ones are taken; a report's free reason (the panel sends «segnalazione»)
  becomes `altro`, the old text moved into `details`, in the migration.
- Body: plain text, 1–10,000 characters for a reply, 1–2,000 for a comment *(my call: a comment is a remark)*. No
  Markdown, no HTML. Paragraphs are blank lines.
- Order on a glossa's page: the accepted reply first, then by votes, then oldest first; comments under a reply oldest
  first. *(My call.)*

### 4.3 Votes and the accepted answer

- Up-votes only, toggled, as today, on glosse and replies; not on comments *(my call: a comment is not an answer)*.
  Voting on one's own glossa or reply becomes a 403 «Non puoi votare un tuo contributo» (today it is allowed).
- `POST /article-discussions/:threadId/accept { commentId | null }` (#205's design): the glossa's author only (403
  otherwise); the comment must be a visible **reply** of that glossa (404 otherwise) and not the author's own (400
  «Non puoi accettare una tua risposta»). `null` withdraws the acceptance. One accepted reply at a time; changing it
  replaces it.
- A hidden or deleted accepted reply stops counting as accepted in every answer (the column is kept, so a reply a
  moderator restores is accepted again). A locked glossa can still change its acceptance.
- The feed's `sort=unanswered` keeps meaning «no visible reply»; a new filter `accepted=false` gives «answered, not
  settled». *(My call: the two questions are different and both useful; #205 left this open.)*

### 4.4 Editing and deletion by the author

- **Editing**: the author edits a glossa's title and body (never its anchor, passage, `articleUrn`, `textHash` or
  target) and a reply's or comment's body: `PATCH /article-discussions/:threadId` and
  `PATCH /article-discussion-comments/:commentId`, the author only (403), not on hidden or deleted content (404), sets
  `edited_at`, shown as «modificata». No edit history in the first cut (§9). A glossa's `updatedAt` (its last
  activity) does not move on an edit *(my call: an edit is not news; #205 already keeps moderation out of it)*.
- **Deleting a reply or comment**: if nothing visible hangs on it (no visible comment under it, not accepted) the row is
  deleted; otherwise its body is emptied, `deleted_at` set, and it shows «Risposta cancellata dall'autore» without the
  author's name, its comments kept.
- **Deleting a glossa**: if no one else replied, the glossa is deleted with its own replies. If others replied, its
  title and body are emptied, `deleted_at` set, and it shows «Glossa cancellata dall'autore» with its anchor and passage
  (the law's words, not the author's) and the replies, which belong to their authors. The deletion is final: emptied
  text is not kept anywhere, save the copy a report keeps for the moderators (G-308, §5.2) *(my call: the point of
  deleting is that the words go)*.
- Routes: `DELETE /article-discussions/:threadId`, `DELETE /article-discussion-comments/:commentId`; the answer says
  which happened (`{ outcome: 'deleted' | 'emptied' }`). Not through the trash: the trash holds a user's private
  material, and a public contribution emptied in place has nothing to restore.

### 4.5 Citing a norm or a decision

- A reply is plain text. The web makes the citations it recognises into links when it **draws** the text, with the
  reader's own scanners (`citationMatcher` → `wrapCitationsInHtml`, `decisionCitationMatcher` →
  `wrapDecisionCitationsInHtml`), which add no character and store nothing. A citation opens as it does in the reader:
  the norm through `triggerSearch`, the decision's preview. Nothing structured is stored in the first cut; the
  convention in `conventions/sources/` governs how VisuaLex *writes* a source, and the Community writes none — it only
  reads what people typed.
- **Security**: the body is escaped first and only then handed to the wrappers, which take HTML. A body is never
  inserted as HTML any other way. `ForumGlossaPage.test.tsx` (or its equivalent) must include a body carrying
  `<img onerror>` and `<script>` and a citation inside markup-like text.
- What a user quotes of a decision inside their own reply is their act; the server does not scan free text. A reply
  copying words a court withdrew is a matter for a report (reason «Violazione di diritti o dati personali»).

### 4.6 The decision's quotation (G-291)

Every Community read (feed, a glossa's page, notifications) withholds a decision's quotation server-side with #205's
shapes — the feed `quote: null, withheld: true`, the glossa's route `passage: null, passageWithheld: true` (its
32-character context included) — unless an admin released it, the reader wrote it, or the reader is an admin.
Moderators see what admins see on a glossa they are handling from the report queue (they must read what was reported),
not in the feed. The per-article route keeps returning the quotation to the reader's panel, which withholds it in
presentation (unchanged; server-side withholding there remains the precondition for opening VisuaLex to the public).

## 5. Moderation

### 5.1 Who (G-266)

- **Responsabili**: the two owners, who are the admins. **Moderatori**: appointed by one of them on a formal request with
  a written commitment, revoked by one of them with a written reason (G-266).
- In the app: `users.forum_moderator`, set by an admin in `PUT /admin/users/:id { forumModerator, reason }`. The reason
  is required for both appointment and revocation and goes to `forum_moderation_log` (`target_kind: user`). The flag is
  read from the database on every moderation call, like `lingoValidatore`. The request and the written commitment stay
  outside the app (G-312).
- An admin can do everything a moderator can. A moderator cannot appoint, cannot release a decision's quotation
  (that stays an admin's act, G-291), cannot delete for good.

### 5.2 Reports

- Any signed-in user reports a glossa or a reply (not their own: 400): `POST /article-discussions/:threadId/report`
  (exists) and `POST /article-discussion-comments/:commentId/report` (new), one per user and item, a second report
  replaces the first and sets it pending again (as today).
- `reason` becomes a closed list (400 otherwise): `offensivo`, `dati_personali`, `spam`, `fuori_tema`,
  `diritti` (copyright, a withdrawn quotation), `altro`; `details` up to 1,000 characters, required for `altro`.
  *(My call; the web words them in Italian.)*
- Queue: `GET /moderation/reports?status=pending|resolved|dismissed` (moderators and admins): one row per reported item
  with its reports grouped (count, reasons, details, the earliest date), the item's full text even if hidden, its
  anchor and a link to its glossa. Oldest pending first.
- **The reported text is kept** (G-308): each report stores `reported_text`, the item's title and body as they were
  when that report was made (a replaced report takes a new copy). The queue shows it beside the item's current text,
  and in its place when the author edited, emptied or deleted the item, so deleting stays the author's right and the
  moderators keep what was reported. Only moderators and admins read it; it never appears in the item's views, the
  feed or an export. Ninety days after the report is resolved or dismissed the copy is erased (the column set to null,
  the report kept as a record), by a sweep that runs at most once a day and is awaited, never fired and forgotten (as
  the trash's sweep).
- Decision: `POST /moderation/reports/:kind/:itemId/resolve { action: 'hide' | 'dismiss', reason }` closes every pending
  report of that item at once, hides it or not, and logs it. *(My call: one decision per item, not per report.)*
- **No automatic hiding** in the first cut, whatever the count *(my call: with a small community a few accounts could
  silence anyone; with registration approved by an admin, a human decision is affordable)*. A pending report shows
  as a count to moderators (the Forum's badge, §6.3).

### 5.3 Hiding, locking

- `PATCH /moderation/threads/:id { hidden?, locked?, category?, reason }` and
  `PATCH /moderation/comments/:id { hidden, category, reason }` (moderators and admins). Hiding takes a `category` from
  the report reasons' closed list (stored in `hidden_reason`) and a free `reason`; the free reason goes only to the log,
  which only moderators and admins read *(my call: a free text may name who reported)*. The existing admin route keeps
  working for `passageReleased` (admins) and logs too.
- A hidden glossa disappears from every list and its page is a 404 «Glossa non trovata», except to its author, who sees
  it with «Nascosta dalla moderazione: <categoria in parole>» and can still delete it (its reports keep their copy, G-308), and
  to moderators. A hidden reply shows as
  «Contenuto rimosso dalla moderazione» where something visible hangs on it, else not at all; its author sees their text
  with the same notice.
- A locked glossa takes no new reply or comment (409 «La discussione è chiusa»); votes, acceptance, edits and deletion
  by authors still work.
- **The glossa's author has no moderation power** over the replies to their glossa: they accept one, they report
  like anyone, they cannot hide or lock. *(Anti-goal of §2.)*

### 5.4 Rate limits and abuse

- Per-user daily counters, by Rome day: the limiter of `spendStudyImport` (Redis when enabled, in-memory otherwise; a
  limiter error lets the write through) but keyed by user **and Rome day** (`romeDay`), since its own window is a
  rolling hour; a key per day is new. Limits: 10 glosse, 60 replies and comments, 20 reports,
  60 edits. Italian 429s («Puoi pubblicare al massimo 60 risposte al giorno: riprova domani.»). The numbers are
  environment variables with these defaults. *(My call.)*
- On top, the existing per-minute tiers (writes 200/min) apply.
- The composer runs the publication check the Forum already uses (`utils/personalDataPatterns.ts`: codice fiscale,
  partita IVA, IBAN, e-mail, PEC, telephone) and marks what it finds, without blocking. *(My call: the same warning
  a dossier gets before it is published.)*
- Persistent abuse: an admin deactivates the account (exists). A suspension from the Community alone is later (§9).
- **Not reachable through MCP.** No Community route enters `oauth/delegatedRoutes.ts`: a connected application can
  neither read nor write the Community. *(My call, a security one: an agent writing public replies in a user's name is
  a decision of its own.)*

## 6. The Community page

### 6.1 Addresses

- **Where the glosse sit in the Forum is the other developer's decision** (G-309: the owner said «ok», then left the
  exact placement to the other developer). The owner's «ok» settles that the glosse are the Community's subject; the
  routes and the page are as below whatever is decided. Recommended: `/forum/community` is the feed, replacing F1's
  placeholder and #205's tab (§3), and «Dossier pubblici» keeps only dossiers.
- `/forum/community` — the feed (recommended placement).
- `/forum/community/glossa/:threadId` — one glossa with its discussion.
- From the reader: each glossa in the discussion panel gets «Apri nella Community», and the Community's «Apri nel testo»
  (#205: an article through its recorded URN and `triggerSearch`, a decision by its `/sentenze/…` address) opens the
  text. Focusing the passage in the reader stays #205's next step.

### 6.2 What the feed shows

One list of discussions (glossa cards: anchor label by the source convention, title or the passage's opening, excerpt,
author, subject, votes, replies, «risposta accettata» mark, last activity). Above it:
- **Order**: «Attive» (default: `active`, last activity), «Recenti», «Più votate», «Senza risposta». *(My call on the
  default; the interface's designer may choose another.)*
- **Filters**: articles / decisions; an act (the user types a citation, the web resolves it with its parser to
  `buildNormaKey`, server filter `act`); a court (`court`, #205); a subject (`materia`, new); «Le mie glosse» (`mine`);
  «Dove ho risposto» (`participated=true`, new: glosse with a visible reply or comment of the reader).
- **Subject**: chosen by the author in the composer from the five subjects, optional; the web pre-selects it for the
  codes it can map (c.c. and its procedure, c.p. and its procedure, and the codice del processo amministrativo), never
  for a law, a decree or a decision. The author can change it later (an edit). Glosse without a subject are listed
  under «Tutte» only. This is the «column the author fills» #205 named. *(My call; it needs the migration.)*

### 6.3 Reads and writes the web needs

| Need | Route | Status |
| --- | --- | --- |
| the feed | `GET /article-discussions/feed` + `materia`, `participated`, `accepted`; items + `acceptedCommentId`, `materia`, `editedAt`, `deleted`, `locked` | #205 + this |
| one glossa | `GET /article-discussions/:threadId`, replies with comments nested, acceptance, the reader's own hidden items with their notice | #205 + this |
| write a glossa | `POST /article-discussions` + `materia` | exists + this |
| reply, comment | `POST /article-discussions/:threadId/comments` (two levels, lock, limits) | exists, changed |
| edit, delete | `PATCH`/`DELETE` on glossa and reply | new |
| vote | existing toggles, own-vote refused | changed |
| accept | `POST /article-discussions/:threadId/accept` | new |
| report | thread (exists, closed reasons), reply (new) | changed + new |
| notifications | `GET /forum/notifications`, `POST /forum/notifications/read { ids | all }`, count in the existing 30 s poll (`useForumNotifications`, into the Forum's `total`) | new |
| moderation | report queue, resolve, hide, lock, appoint | new |
| licence | `GET /lingo/testi/CONTRIBUTO_COMMUNITY` (the existing text route) and acceptance with the first write | new key |

### 6.4 Notifications

Written in the same transaction as the event, to:
- the glossa's author, for a new reply (`reply`);
- a reply's author, for a comment under it (`comment`) and for its acceptance (`accepted`);
- the author of anything hidden by moderation (`hidden`, with the reason's category, never the moderator's name).

Never for one's own act. In the app only: the Forum's badge and a list in the Community page. No e-mail (VisuaLex sends
none today). Read ones are deleted after 90 days *(my call)*.

## 7. Privacy and licence

### 7.1 Public by design

Glosse and replies are visible to every signed-in user, under their username. Never to anonymous visitors in this cut.
The composer's notice of #205 extends to replies: «Le risposte sono pubbliche nella Community».

### 7.2 Licence (G-283)

G-283 recommended CC BY-SA 4.0 for the community's contributions, to be settled with the other developer. This design assumes it and
makes it concrete: a versioned text `CONTRIBUTO_COMMUNITY` (a new key of the texts to accept, administered like
`PROPOSTA_SCHEDA`). Its version 1 is written by the second migration, in words the owners approve before it is applied
(drafted with the plan), so there is never a moment without a text. It works as `proponi` does: a glossa, reply or
comment whose author has not accepted the **current** version carries that version's id or gets 409 with the text
(`{ detail, richiedeTesto }`), nothing written; a new version asks again. Every contribution records the version it was
written under (`licence_text_id`), so what is under the licence is known row by row. Accepting it licenses what one
writes from then on. What was written before (`licence_text_id` null) stays visible inside VisuaLex as it is today, and
is not relicensed silently (G-310: «ok»). *(My calls: version 1 in the migration, a new acceptance per version, the
version on each row.)*

### 7.3 Deleting the account (G-307)

Today deleting an account deletes its glosse **with every reply others wrote under them** (cascade). The owner chose
(G-307, «c»): **the contributions stay, with their text, without an author**.
- `user_id` becomes null on the person's glosse, replies and comments (`ON DELETE SET NULL` replaces the cascade), and
  every view names the author «utente cancellato». What others wrote under them is never deleted.
- What goes with the account: their votes and their notifications. Their reports stay without a reporter (§4.1);
  the moderation log keeps each act with `actor_id` null.
- What the person had emptied (§4.4) stays emptied; an accepted answer stays accepted.
- An anonymous contribution can no longer be edited, deleted or accepted by anyone, its glossa's acceptance included.
  Moderators can still hide it.
- **Before deleting**, the person can delete their contributions one by one (§4.4), and the deletion dialog says so:
  glosse, replies and comments stay, anonymous, unless deleted first; it links the Community filtered on «Le mie
  glosse» and «Dove ho risposto». **The privacy notice** (VisuaLex's, at its next version) must say the same:
  published contributions outlive the account, without the author's name.
- **Residual risk**: a text can identify its author by itself — a signature, a firm's name, a case only they handled,
  a recognisable style — and other people's replies may name their username. Making a contribution anonymous removes
  the link in the database, not what the words say. After the account is gone, the person can still ask the owners to
  empty a contribution: an admin empties it as §4.4 does, logged with the request as reason *(my call: erasure must
  stay possible after the account is gone)*.
- `deleteUserAccount` does it in its transaction: the `SET NULL`s do most of it, as for Gymnasium's community cards.

### 7.4 Export

`GET /auth/export` carries the person's glosse and replies (text, anchor, dates, edited/deleted marks), their votes
(target ids), their reports (reason, details, date) and their notifications. **It must not carry other people's
replies**: today it includes every comment under the person's threads, with their authors' ids and text. The owner
approved the fix (G-306); it is its own pull request, `fix/export-other-users-data`, outside this design. The
Community's export builds on it. A report's `reported_text` is never exported: it is the moderators' record.

### 7.5 What leaves VisuaLex

Nothing. The Community sends no event to MERL-T and nothing to an AI in this cut; no MCP route reads it (§5.4).

## 8. Security notes for the builder

- Ownership is checked on every edit, delete and accept against the session's user (IDOR); a hidden or deleted item
  answers like a missing one to whoever may not see it.
- A contribution may have no author (§7.3): every view and check handles a null `user_id` (today `threadView` reads
  `thread.user.id`, which would throw), and a null author is never anyone's own.
- Moderator and admin rights are read from the database on each call; `requireAdmin` stays for admin-only acts.
- Body rendering: §4.5.
- Every new route answers its 400/403/404/409/429 in Italian through `parseItalian`.
- No route reachable by an exchanged token (§5.4).

## 9. First cut, later, migration

**First cut (1.10)**, in this order, each a pull request with its review:
1. Server, data: the migration (§4.1) and the licence key's migration (a new enum value cannot be used in the
   transaction that adds it: two migrations, as `20261024100000`/`…01`), account deletion (§7.3), the reports' copy
   and its sweep (§5.2). The export fix is already its own pull request (G-306).
2. Server, routes: replies at two levels, edit, delete, accept, own-vote refusal, closed report reasons and reply
   reports, moderation queue and acts with the log, notifications, limits, feed filters. **The reader's discussion
   panel changes in the same pull request**, so the reader never breaks between the two: it sends a reason from the
   closed list (today it sends «segnalazione»), asks for the licence on a 409, says when a discussion is closed, stops
   offering a vote on one's own content and a reply to a comment, and lets the author edit and delete their own glossa
   and replies. Accepting an answer is the Community page's, not the panel's; the panel shows the mark and «Apri nella
   Community». *(My call: the panel stays a full place to discuss; G-304 makes the two one conversation.)*
3. Web: the Community page and a glossa's page, the notifications, the moderation queue (in the admin page for admins,
   under the Forum for moderators). The other developer designs them in the Inchiostro language; this pull request
   waits for that design and wires the data to it. No mock-up exists today.

**Migration names**: two, to reserve with the orchestrator once this design is approved (none is reserved yet).

**Later**
- The other developer's idea: a dossier attached to a discussion; AI drawing ordered glosse from a debate, valid only once the
  participants validate them (§11).
- Edit history visible to moderators; suspension from the Community; auto-hiding past a threshold; muting a glossa's
  notifications; e-mail digests; mentions.
- Votes and accepted answers as inputs to points, levels and authority (G-303's spec).
- Reading without an account, after the decision on opening VisuaLex to the public.
- Structured citations in a reply (a chip with a stored key, labelled by the convention).

## 10. Calls made in this design

Marked *(my call)* in the text: two levels of replies; reply and comment lengths; the order of replies; no votes on
comments and none on one's own content; `accepted=false` next to `unanswered`; edits do not move the last activity;
emptied text is not kept; deletion outside the trash; closed report reasons; one decision per reported item; no
automatic hiding; the daily limits; the personal-data check in the composer; no MCP access; the feed's default order;
the subject column and its pre-selection; notifications kept 90 days; existing data left as stored; the moderator's
free reason kept to the log, a category shown to the author; the licence's version 1 in the migration, a new acceptance
per version and the version on each row; the reader's panel kept complete and changed with the server routes; reports
outliving their reporter's account; an admin emptying an anonymous contribution on request; the reported text's
sweep once a day.

## 11. The owners' answers, and what is still open

The owner answered on 20 October 2026; G-309 to G-312 also need the other developer's word.

| Question | Answer |
| --- | --- |
| G-306 The export hands over other users' replies: fix it now? | «ok»: its own pull request, `fix/export-other-users-data` (§7.4) |
| G-307 Account deletion | «c»: the text stays, without an author (§7.3) |
| G-308 Deleting what was reported | «ok»: a report keeps a copy for the moderators until 90 days after it is closed (§5.2) |
| G-309 Where the glosse live | «ok», the exact placement left to the other developer (§6.1) |
| G-310 Licence CC BY-SA 4.0, a versioned text accepted at the first write | «ok» (§7.2) |
| G-311 First cut: only discussions anchored on a norm or a decision | «ok» (§1) |
| G-312 Moderators' request and commitment outside the app | «ok» (§5.1) |

**Still open**
- The other developer: the placement of the glosse in the Forum (G-309; recommended in §6.1), and their word on
  G-310, G-311 and G-312.
- Later, not needed for the first cut: the AI step (a dossier attached to a discussion, glosse drawn from a debate) —
  who answers for a glossa an AI drew, whether participants' replies may be read by an AI at all (MERL-T consent, the
  forum-authoring decision), and who validates (all participants, a majority, each for their own part).
