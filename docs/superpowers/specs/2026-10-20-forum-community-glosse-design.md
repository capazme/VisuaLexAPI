# The Forum's Community: discussion on someone's glossa

Written 20 October 2026 and brought up to date with `develop` on 29 October 2026 (at 6b1c3f90). Status:
**approved by the owner for the server** (G-392, 30 October 2026: Q-1 to Q-6 «ok» as recommended; pull requests 1
and 2 start now). Pull request 0 (the word) and pull request 3 (the web) wait for the other developer's yes on Q-1 and
G-309 to G-312 (§9, §12). It builds on the draft pull request #205
(`feat/glosse-forum`, spec `2026-10-19-glosse-forum-design.md`) and on the decisions G-265, G-266, G-283, G-291,
G-292, G-293 and D-076. The owner's answers G-306 to G-312 (19 October 2026) are folded in; G-309 to G-312 also wait
for the other developer's word (§12).

The owner, 29 October 2026, evening: «La prossima priorità è far funzionare il forum, ovvero aggregare i
threads che si creano dalle glosse». This revision answers what that needs (§6), and what «glosse» means now that D8
gave the word a second sense (§2).

## 0. What changed since 20 October

Re-verified against `develop` on 29 October. Each line says what the first version said and what is true today.

| Then | Today |
| --- | --- |
| `GET /auth/export` hands over other users' replies under one's glosse (G-306, to be fixed in its own PR) | **Fixed** (#229, then #236 and #246): a glossa in the export carries `repliesFromOthers`, a count; others' replies are never read. §7.4 now builds on it. Votes and reports are still not exported. |
| `ArticleThreadReport` is written and read by nothing | **Still true.** `reportThread` upserts; no route, no screen reads the table. |
| Deleting an account cascades away others' replies | **Still true.** `deleteUserAccount` (`lingo/deleteUserAccount.ts`) now also locks courses and cards, then deletes the user row; `article_threads.user_id` and `article_comments.user_id` are still `ON DELETE CASCADE`. |
| `ArticleThread` / `ArticleComment` / votes / reports as described in §4 | **Unchanged.** No migration touched them; depth is still limited to three levels, voting on one's own content is still allowed. |
| `/forum/community` is F1's placeholder | **S7a (#292, release 1.10.1) redrew it**: still a placeholder («Le discussioni arrivano presto»), now in `PageFrame`, beside «Dossier pubblici» (`/forum`) whose three tabs are Esplora, I miei pubblicati, Suggerimenti. |
| #205 can merge as it is | **No longer cleanly.** It is 896 commits behind `develop`. Its server part (feed, one glossa's route, withholding, paging fix) still merges without conflict; its web part conflicts (`BulletinBoardPage.tsx`, where its «Glosse» tab sits, rewritten by S7a, and `apps/web/CLAUDE.md`) and is superseded by the Community page. See §4. |
| The Forum is the only «glossa» | **D8 (#366, #368, merged 29 October) calls an assistant's note on a passage a «glossa»** («Glossa dell'IA»), a `Highlight` row of `kind = 'gloss'` in a dossier. §2. |
| A per-user daily counter needs a new key per Rome day | **A pattern exists now**: the MCP's named daily counters (`middleware/delegated.ts`: `createLimiter(prefix, points, DAY_SECONDS)`, a 24-hour window from the first use, Redis when enabled). §5.8 reuses it. |
| Migration names: two, to reserve | **Reserved** (29 October): `20261031100000_community_licence_key`, `20261031100001_forum_community`. §9. |

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
decisions this spec does not take (§12).

### Words

| In the interface | In the code | What it is |
| --- | --- | --- |
| glossa | `ArticleThread` | a public comment on an article or a decision, by one author (D-076: the Forum's comments and threads are «glosse») |
| risposta | top-level `ArticleComment` (`parentId` null) | an answer to the glossa; may be accepted |
| commento | nested `ArticleComment` | a remark under a reply |
| discussione | a glossa with its replies | what the Community lists |
| risposta accettata | `article_threads.accepted_comment_id` | the reply the glossa's author marked as the one that settled it |
| *(D8, today also «glossa»)* | `Highlight` with `kind = 'gloss'` | an assistant's note on a passage of a dossier entry, validated by the user: private, never in the Forum. §2 |

## 2. Two things called «glossa»

### 2.1 The two

| | Forum glossa | D8 glossa |
| --- | --- | --- |
| What | a user's commentary on an article or a decision, the start of a discussion | a note an assistant (a connected application) wrote on a passage of a dossier entry |
| Who writes it | the user, in the reader's discussion panel | the application, through `omnilex_glossa_voce`; the user validates, edits, moves or removes it |
| Model | `ArticleThread` (+ `ArticleComment`) | `Highlight`, `kind = 'gloss'`, `created_by_client_id` set, `note_state` |
| Anchor | `passage_quote`, `passage_start`, prefix/suffix, `article_urn`, `text_hash` | `(startOffset, text)` in the dossier entry's projection (root rule 23), `assistant_*` for the model's original |
| Visible to | every signed-in user | its owner only, in the dossier's reader; kept out of `GET /highlights`, Study Mode, the Forum, environments and the PDF |
| Switch | none | `assistant_glosses` (writing, off) and `assistant_passages` (the web's side) |
| Words in code | `thread`, `discussion` | `gloss`; visible words only in `apps/web/src/constants/glossWords.ts` (`GLOSS_WORDS`) |

### 2.2 Where a user sees both

- **A decision in a dossier.** `DecisionReadingSurface` is the reader of a decision both in «Sentenze» and inside a
  dossier (`DossierDecisionReader`). It wires the Forum's discussions (`useDiscussionWiring`) and, since #368, the
  D8 column (`GlossMargin`). One sign can then say «1 glossa in questo passo; 1 glossa dell'IA: 1 da validare»
  (`signAriaLabel`, `utils/articleAnnotations.ts`), and the sign's popover offers «Apri glossa» (the Forum's) beside
  «Vai alla glossa a margine» (D8's).
- **An article.** Not on the same screen today: the main reader (`ArticleTabContent`) shows the Forum's glosse and no
  D8 glossa; the dossier's article reader (`DossierItemReader`) shows D8 glosse and no Forum glossa. The same user
  moving from one to the other meets the same word for two different things.
- **The Community page.** It will list «glosse»: a user who has just validated «glosse» in their dossier will look for
  them there and not find them. That is the confusion the owner's warning names.
- **Consent and the MCP.** The words a user approves for `dossier:write` say «glossarne i passaggi come proposte che
  validi tu» (`oauth/consent.ts`); the delegated counter is named «glosse proposte» (`apps/mcp/src/exchange.ts` and the server's 429 in
  `middleware/delegated.ts`; #366 chose it so as not to say «glosse sui passaggi», the Forum's phrase).

### 2.3 What «aggregate the threads born from glosses» means for each

- **Forum glossa.** A glossa *is* the thread's opening: aggregating means a feed of every visible `ArticleThread` with
  its discussion, across articles and decisions (§6). That is this design.
- **D8 glossa.** It starts no thread: it is private, and nothing in the Forum reads `highlights`. There is nothing to
  aggregate unless a D8 glossa is first **published** as a Forum glossa, which today has no path.

### 2.4 Can a validated D8 glossa start a discussion? Is it the user's then?

Possible, as a later step, and only as a **copy made by the user's own act**:

- **The gesture.** On a validated D8 card, «Pubblica nel Forum» opens the reader's composer pre-filled with the note as
  body and the passage as the glossa's passage, for the user to read, change and publish. The D8 row stays as it is,
  private; the Forum glossa is a new `ArticleThread`, with its own anchor computed by the composer as for any passage
  (the two anchor models differ, §2.1, and neither is rewritten: root rule 23). No link is kept between the two
  *(my call: a link would let a private row explain a public one, and a removal of one would have to decide about
  the other)*.
- **Whose it is.** The user's, once published: they wrote the act of publication, accepted the licence (§7.2), can
  edit and delete it like any glossa, and answer for it in moderation. Validation alone does not make a D8 glossa
  public, and an application can never publish (no Community route is reachable through MCP, §5.8).
- **Disclosure.** Whether a published glossa that started as an assistant's text says so («redatta con l'aiuto
  dell'IA») is an owners' choice (§12, Q-3). The user's review and the act of publication are the editorial
  control; the owners may still prefer to say it, for the readers' trust. The legal reading (for instance of the AI
  Act's transparency duties for published text) is for the owners, not for this spec.
- **First cut: no.** The Community is built first on the glosse people write; the bridge is a web step afterwards (§9,
  «Later»), when the word question (§2.5) is settled — otherwise the button would read «Pubblica la
  glossa come glossa».

### 2.5 Naming options (the owner chose B, G-392; the other developer's answer to D8's question 5 is pending)

| Option | Forum's word | D8's word | What changes | Against |
| --- | --- | --- | --- | --- |
| **A. Keep both** | glossa | glossa dell'IA | nothing (today's state, #368) | the Community page and the dossier reader use one noun for two things; «dell'IA» is wrong once the user validated and rewrote it; §2.4's button cannot be worded |
| **B. Rename D8** *(recommended)* | glossa | **postilla** (or «nota a margine») | `GLOSS_WORDS` (one file, its feminine agreements hold for «postilla»); the `dossier:write` consent sentence (`oauth/consent.ts`); the counter's label (`apps/mcp/src/exchange.ts`, `middleware/delegated.ts`) and the tool's descriptions (`apps/mcp/src/tools/glosses.ts`); the switch's description (`assistant/switches.ts`). Identifiers (`gloss`, `omnilex_glossa_voce`, `kind = 'gloss'`) stay | the column «a margine» loses the medieval «glossa», which fits a note in the margin |
| C. Rename the Forum's | discussione / commento | glossa | overturns D-076; the server's messages (#192), the reader's panel, the toolbar, the composer, the Community copy; G-304's own words lose their noun | most work, against a recorded decision |
| D. Rename both | — | — | both lists above | no gain over B |

**The owner's choice (G-392): B, with «postilla»**, as recommended; pull request 0 waits for the other developer's
word on it (D8's question 5). **The reasoning:** D-076 named the Forum's threads «glosse» and the server already speaks that
way; D8's word lives in one constant by design and its writing switch is still off, so no user has learnt it yet.
«Postilla» is a single word, feminine (the states «Validata», «Da rivedere» and «Glossa rimossa» → «Postilla
rimossa» keep their agreement), distinct from «nota», which already names the user's notes and the dossier's notes.
«Nota a margine» reads well in the column but collides with «nota». A precedent: an assistant's explanation of an
article was already given a name of its own («Spiegazione», brief N1) so that «glossa» stayed the Forum's.

Whatever is chosen, the Community's copy is written after the answer, and the word goes in the web before the
Community page ships (§9).

## 3. Goals, non-goals, anti-goals

**Goals**
- A lawyer reading an article sees that colleagues discussed a passage, opens the discussion, answers it with a
  reasoned reply that may cite norms and decisions, and the glossa's author can say which answer settled it.
- The Community page shows what is being discussed now, by article or act, by court, by subject.
- The two owners and the moderators they appoint (G-266) can see what was reported, hide what breaks the rules,
  and every such act is on record with its reason.
- The glossa's author learns that someone answered.

**Non-goals (first cut)**
- Free questions without a norm or a decision.
- AI on discussions (summaries, glosse drawn from a debate, answers by Claude through MCP), and publishing a D8 glossa
  (§2.4).
- Anonymous readers or search engines: everything stays behind the login (ADR-001).
- Direct messages, mentions, following people, e-mail notifications, downvotes, reputation shown on profiles
  (points and levels are G-303's spec).

**Anti-goals: it fails even if it works when**
- someone's words outlive their own deletion of them (§5.5), or outlive their account without their having been told
  so beforehand (§7.3);
- a moderator acts with no trace, or a glossa's author can silence the replies that disagree with them (§5);
- a decision's withdrawn quotation is made easier to find by the Community than it is today (G-291, §5.6: the per-article route still returns it to any signed-in user, a residual risk this design does not widen);
- a D8 glossa, or anything else private, reaches the Community without its owner's act of publication (§2.4);
- the reader's anchors move or vanish because of anything the Community does (root rule 23: the Community never
  writes an article's or a decision's text, and never rewrites a stored passage).

## 4. What exists, and what #205 gives

Today (`develop`, 29 October): `ArticleThread` (anchor, optional passage, title, body, author, `isHidden`),
`ArticleComment` (`parentId`, depth limited to three levels), toggled up-votes on both, own content included,
`ArticleThreadReport` (one per user and glossa, written and **never read by any route or screen**),
`PATCH /admin/article-discussions/:id` (admins: `hidden`, `passageReleased`), `GET /article-discussions` (one
article's or decision's glosse, paged) and `GET /article-discussions/passages` (the anchored ones, for the reader's
signs). No editing, no deletion by the author, no reports on replies, no notifications. Every route is behind
`authenticate`; accounts are created by registration **approved by an admin** (`isActive: false` until then), so
writing is open only to people the owners let in. `/forum/community` is S7a's placeholder.

#205 (draft, last touched 19 October) adds `GET /article-discussions/feed` (every visible glossa; sorts
`recent|popular|active|unanswered`; filters `kind`, `act`, `normaKey`, `court`, `mine`; pages), `GET
/article-discussions/:threadId` (one glossa with its visible replies), the server-side withholding of a decision's
quotation outside the reader (G-291), an Italian 400 for a non-numeric `page`/`limit` (a 500 today), moderation that
no longer moves `updatedAt`, the composer's notice that a glossa is public, and an unstyled «Glosse» tab.

**What #205 still gives.** Its server part is current: the court prefixes match today's decision keys (including
the administrative courts and the Union's), and the controller and routes merge with `develop` without conflict. Its
tests (`articleDiscussions.feed.test.ts`) are the feed's. Its composer notice and `glossaLinks.ts` («Apri nel testo»)
are still wanted.

**What is now wrong in it.** The «Glosse» tab inside «Dossier pubblici»: S7a rewrote `BulletinBoardPage` and its tabs,
and under this design the feed *is* the Community page. **Recommended** *(my call on the process, the owners'
on the outcome, §12 Q-4)*: #205 is not merged; its server commits and tests are carried into this design's
server pull request 2 (§9), its composer notice and `glossaLinks.ts` into the reader-panel changes of pull request
2c, and #205 is closed with a pointer (G-392).

## 5. The model

### 5.1 Entities and changes (migrations of §9)

`article_threads` (the glossa) gains:
- `accepted_comment_id` — nullable, FK to `article_comments`, `ON DELETE SET NULL` (the column #205 designed, G-292).
- `edited_at` — set when the author edits title or body; null otherwise.
- `deleted_at` — set when the author deletes a glossa that others answered (§5.5).
- `locked_at`, `locked_by` — a moderator closed it to new replies (`locked_by` FK to `users`, `SET NULL`).
- `materia` — nullable `LingoMateria` (the five subjects of Gymnasium), the author's choice (§6.2).
- `user_id` becomes **nullable**, `ON DELETE SET NULL` instead of `CASCADE` (G-307, §7.3).
- `last_activity_at` — the glossa's last activity: set at creation and by a new reply or comment, by nothing else;
  backfilled by the migration from the glossa's creation and its latest reply or comment (not from `updated_at`,
  which an administrator's hiding or release also moved). `updated_at` is Prisma's `@updatedAt` and moves on *every* update
  (an edit, an acceptance, a lock, a hiding, an emptying, a subject changed); #205 had to hold it still by hand for
  moderation. An explicit column ends that: the feed's «Attive» and «last activity» read `last_activity_at`
  *(my call)*.
- indexes `(is_hidden, created_at)` and `(is_hidden, last_activity_at)` for the feed (#205's decision 3, on the new
  column).

On both `article_threads` and `article_comments`:
- `hidden_reason` — the closed category of §5.7 a moderator chose when hiding; null when visible.
- `licence_text_id` — FK to the versioned text the author accepted when writing it (§7.2), `RESTRICT`; null for what
  was written before the text existed.

`article_comments` (replies and comments) gains `edited_at`, `deleted_at`, and the same nullable `user_id`
(`SET NULL`, G-307).

New tables:
- `article_comment_reports` — as `article_thread_reports` (one per user and reply, `reason`, `details`, `status`,
  and a plain `thread_id` too, so a report on a reply deleted for good still leads to its glossa), plus
  on both report tables `resolved_by` (FK `users`, `SET NULL`), `resolved_at`, `resolution_note` and `reported_text`
  (G-308, §5.7). On both, the item is named by a plain id with **no foreign key** (`thread_id`, `comment_id`, as
  `about_item_id` is on dossier notes), so a report keeps pointing at the item it copied after the item is deleted
  for good, and the queue and its decision still work on it (§5.7); the reporter's `user_id` becomes nullable with `SET NULL` too, so a pending report outlives its reporter's
  account *(my call: it is the moderators' evidence)*.
- `forum_notifications` — `user_id` (the recipient, cascade), `kind`, `thread_id`, `comment_id` (both cascade),
  `created_at`, `read_at`. No actor column: the reply names its author already; a notification whose reply is
  deleted goes with it.
- `forum_moderation_log` — append-only: `actor_id` (`SET NULL`), `action`, `target_kind`
  (`thread|comment|report|user`), `target_id`, `reason` (required, 3–1000 characters), `created_at`. Until pull
  request 2c, releasing or withholding a decision's quotation may come without a reason (the panel sends none,
  §9): the column is nullable for those two actions alone, a CHECK.
- Emptied means empty: a CHECK holds `title` and `body` (a reply's `body`) at `''` whenever `deleted_at` is set
  (§5.5).

`users` gains `forum_moderator` (boolean, default false), set like `lingoValidatore`.

`LingoTestoChiave` gains `CONTRIBUTO_COMMUNITY` (§7.2), in a migration of its own (§9).

Nothing changes on `highlights`: a D8 glossa is not part of the Community (§2).

### 5.2 Replies and comments

- A **risposta** is a top-level reply; a **commento** sits under a reply. New writes are limited to **two levels**
  (reply, comment under it): the server answers 400 «Si può commentare una risposta, non un commento» to a `parentId`
  that is itself a comment. Replies already stored at the third level stay and are shown under their reply, flattened.
  *(My call: the accepted answer needs a clear unit, and a third level is where a Stack Overflow–style page turns into a
  chat. Overturnable.)*
- **Data already stored stays as it is** *(my call)*: third-level replies are shown flattened; votes on comments and on
  one's own content stay counted but no new ones are taken; a report's free reason (the panel sends «segnalazione»)
  becomes `altro`, the old text moved into `details`, in the migration.
- **Visible** means not hidden by moderation and not emptied by its author. An emptied reply (§5.5) stays as a place
  for the comments under it but is not a reply: it does not count in the replies, does not end «Senza risposta» and
  cannot be accepted. **Others** means any author other than the glossa's, anonymous ones included (§7.3).
- Body: plain text, 1–10,000 characters for a reply, 1–2,000 for a comment *(my call: a comment is a remark)*. No
  Markdown, no HTML. Paragraphs are blank lines.
- Order on a glossa's page: the accepted reply first, then by votes, then oldest first; comments under a reply oldest
  first. *(My call.)*

### 5.3 Votes and the accepted answer

- Up-votes only, toggled, as today, on glosse and replies; not on comments *(my call: a comment is not an answer)*.
  Voting on one's own glossa or reply becomes a 403 «Non puoi votare un tuo contributo» (today it is allowed).
- `POST /article-discussions/:threadId/accept { commentId | null }` (#205's design): the glossa's author only (403
  otherwise); the comment must be a visible **reply** of that glossa (404 otherwise) and not the author's own (400
  «Non puoi accettare una tua risposta»). `null` withdraws the acceptance. One accepted reply at a time; changing it
  replaces it. A glossa whose author is gone (§7.3) keeps its acceptance as it is: nobody can change it (403). An
  anonymous reply can still be accepted by the glossa's author *(my call: accepting it needs nothing from its
  author)*.
- A hidden or deleted accepted reply stops counting as accepted in every answer (the column is kept, so a reply a
  moderator restores is accepted again). A locked glossa can still change its acceptance.
- The feed's `sort=unanswered` keeps meaning «no visible reply»; a new filter `accepted=false` gives «answered, not
  settled». *(My call: the two questions are different and both useful; #205 left this open.)*

### 5.4 Citing a norm or a decision

- A reply is plain text. The web makes the citations it recognises into links when it **draws** the text, with the
  reader's own scanners (`utils/citationMatcher.ts` → `wrapCitationsInHtml`, `utils/decisionCitationMatcher.ts` →
  `wrapDecisionCitationsInHtml`), which add no character and store nothing. A citation opens as it does in the reader:
  the norm through `triggerSearch`, the decision's preview. Nothing structured is stored in the first cut; the
  convention in `conventions/sources/` governs how VisuaLex *writes* a source, and the Community writes none — it only
  reads what people typed.
- **Security**: the body is escaped first and only then handed to the wrappers, which take HTML. A body is never
  inserted as HTML any other way. The glossa page's test must include a body carrying `<img onerror>` and `<script>`
  and a citation inside markup-like text.
- What a user quotes of a decision inside their own reply is their act; the server does not scan free text. A reply
  copying words a court withdrew is a matter for a report (reason `diritti`).

### 5.5 Editing and deletion by the author

- **Editing**: the author edits a glossa's title, body and subject (never its anchor, passage, `articleUrn`,
  `textHash` or target) and a reply's or comment's body: `PATCH /article-discussions/:threadId` and
  `PATCH /article-discussion-comments/:commentId`, the author only (403), not on hidden or deleted content (404), sets
  `edited_at`, shown as «modificata»; a change of subject alone does not set it *(my call: it is a classification, not the text)*.
  An edit made after a new version of the licence asks for it like a first write (§7.2) and records the new version
  on the row. No edit history in the first cut (§9). A glossa's last activity (`last_activity_at`,
  §5.1) does not move on an edit *(my call: an edit is not news)*.
- **Deleting a reply or comment**: if nothing visible hangs on it (no visible comment under it, not accepted) the row is
  deleted; otherwise its body is emptied, `deleted_at` set, and it shows «Risposta cancellata dall'autore» without the
  author's name, its comments kept.
- **Deleting a glossa**: if no one else replied, the glossa is deleted with its own replies. If others replied, its
  title and body are emptied, `deleted_at` set, and it shows «Glossa cancellata dall'autore» with its anchor and passage
  (the law's words, not the author's) and the replies, which belong to their authors. The deletion is final: emptied
  text is not kept anywhere, save the copy a report keeps for the moderators (G-308, §5.7) *(my call: the point of
  deleting is that the words go)*.
- **Deciding and deleting are one step.** `article_comments.thread_id` and `parent_id` cascade, so a reply written
  between the check and the delete would go with it, silently. The delete runs in one transaction that locks the
  glossa's row (`SELECT … FOR UPDATE`) and, for a reply, the reply's row; `createComment` takes the same locks (the
  glossa, and the parent reply when there is one) before it inserts. Under the lock the check counts **every** row
  under the item, hidden ones included: a hidden reply of someone else is still theirs, and the moderators' record.
  Only when nothing at all hangs on the item is the row deleted; otherwise it is emptied.
- Routes: `DELETE /article-discussions/:threadId`, `DELETE /article-discussion-comments/:commentId`; the answer says
  which happened (`{ outcome: 'deleted' | 'emptied' }`). Not through the trash: the trash holds a user's private
  material, and a public contribution emptied in place has nothing to restore.

### 5.6 The decision's quotation (G-291)

Every Community read (feed, a glossa's page, notifications) withholds a decision's quotation server-side with #205's
shapes — the feed `quote: null, withheld: true`, the glossa's route `passage: null, passageWithheld: true` (its
32-character context included) — unless an admin released it, the reader wrote it, or the reader is an admin.
Moderators read a reported glossa's quotation **in the queue's answer**, which carries the anchor whole with it
(they must read what was reported); on the feed and the glossa's route a moderator is a reader like any other. The per-article routes (`GET /article-discussions`, `…/passages`) keep returning the quotation to the
reader's panel, which withholds it in presentation (unchanged; server-side withholding there remains the precondition
for opening VisuaLex to the public).

### 5.7 Moderation

**Who (G-266).**
- **Responsabili**: the two owners, who are the admins. **Moderatori**: appointed by one of them on a formal request with
  a written commitment, revoked by one of them with a written reason (G-266).
- In the app: `users.forum_moderator`, set by an admin in `PUT /admin/users/:id { forumModerator, reason }`. The reason
  is required for both appointment and revocation and goes to `forum_moderation_log` (`target_kind: user`). The flag is
  read from the database on every moderation call, like `lingoValidatore`. The request and the written commitment stay
  outside the app (G-312).
- An admin can do everything a moderator can. A moderator cannot appoint, cannot release a decision's quotation
  (that stays an admin's act, G-291), cannot delete for good.

**Reports.**
- Any signed-in user reports a glossa or a reply (not their own: 400): `POST /article-discussions/:threadId/report`
  (exists) and `POST /article-discussion-comments/:commentId/report` (new), one per user and item, a second report
  replaces the first and sets it pending again (as today).
- `reason` becomes a closed list (400 otherwise): `offensivo`, `dati_personali`, `spam`, `fuori_tema`,
  `diritti` (copyright, a withdrawn quotation), `altro`; `details` up to 1,000 characters, required for `altro`.
  *(My call; the web words them in Italian.)*
- Any reply or comment can be reported, at either level; «a reply» below means both.
- Queue: `GET /moderation/reports?status=pending|resolved|dismissed` (moderators and admins): one row per reported item
  (`kind` and the item's id, §5.1) with its reports grouped (count, reasons, details, the earliest date), the item's full text even if hidden, its
  anchor and a link to its glossa. Oldest pending first.
- **The reported text is kept** (G-308): each report stores `reported_text`, the item's title and body as they were
  when that report was made (a replaced report takes a new copy). The queue shows it beside the item's current text,
  and in its place when the author edited, emptied or deleted the item, so deleting stays the author's right and the
  moderators keep what was reported. Only moderators and admins read it; it never appears in the item's views, the
  feed or an export. Ninety days after the report is resolved or dismissed the copy is erased (the column set to null,
  the report kept as a record), by a sweep that runs at most once a day and is awaited, never fired and forgotten (as
  the trash's `maybeSweep`). It is called by every Community route that writes (a glossa, a reply, a report, an
  edit, a deletion) and by the queue, so the erasure does not wait on how often moderators open the queue; the same
  sweep deletes read notifications older than 90 days (§6.5).
- **An item deleted for good while reported** (its author deleted it when nothing hung on it, §5.5): its pending
  reports stay pending with their copy, the queue shows the copy and «eliminato dall'autore», and the moderator closes
  them like any other (`dismiss`; `hide` has nothing left to hide and is refused 409). The 90 days run from that
  closing.
- Decision: `POST /moderation/reports/:kind/:itemId/resolve { action: 'hide' | 'dismiss', reason }` closes every pending
  report of that item at once (found by the reports' own `kind` and item id, so it works on a deleted item), hides it
  or not, and logs it. *(My call: one decision per item, not per report.)*
- **No automatic hiding** in the first cut, whatever the count *(my call: with a small community a few accounts could
  silence anyone; with registration approved by an admin, a human decision is affordable)*. A pending report shows
  as a count to moderators (the Forum's badge, §6.5).

**Hiding, locking.**
- `PATCH /moderation/threads/:id { hidden?, locked?, category?, reason }` and
  `PATCH /moderation/comments/:id { hidden, category, reason }` (moderators and admins). Hiding takes a `category` from
  the report reasons' closed list (stored in `hidden_reason`) and a free `reason`; the free reason goes only to the log,
  which only moderators and admins read *(my call: a free text may name who reported)*. The existing admin route
  `PATCH /admin/article-discussions/:id` loses `hidden` (hiding goes through `/moderation/…` alone, with its category
  and reason) and keeps `passageReleased` (admins), now with a required `reason` that goes to the log.
- A hidden glossa disappears from every list and its page is a 404 «Glossa non trovata», except to its author, who sees
  it with «Nascosta dalla moderazione: <categoria in parole>» and can still delete it (its reports keep their copy,
  G-308), and to moderators. A hidden reply shows as «Contenuto rimosso dalla moderazione» where something visible
  hangs on it, else not at all; its author sees their text with the same notice.
- A locked glossa takes no new reply or comment (409 «La discussione è chiusa»); votes, acceptance, edits and deletion
  by authors still work.
- **The glossa's author has no moderation power** over the replies to their glossa: they accept one, they report
  like anyone, they cannot hide or lock. *(Anti-goal of §3.)*

### 5.8 Rate limits and abuse

- Per-user daily counters with the pattern the MCP's named counters use (`createLimiter(prefix, points,
  DAY_SECONDS)` in `middleware/rateLimiter.ts`: Redis when enabled, in-memory otherwise, a 24-hour window from the
  first write, a limiter error lets the write through). Limits: 10 glosse, 60 replies and comments, 20 reports,
  60 edits. Italian 429s of their own (`sendTooManyRequests` in `rateLimiter.ts` answers in English), that do not promise a calendar day («Hai pubblicato 60 risposte nelle ultime 24 ore: riprova
  più tardi.»). The numbers are environment variables with these defaults. *(My call; it replaces the first
  version's key per Rome day, which nothing else uses.)*
- On top, the existing per-minute tiers (writes 200/min) apply.
- The composer runs the publication check the Forum already uses for dossiers (`utils/personalDataPatterns.ts`:
  codice fiscale, partita IVA, IBAN, e-mail, PEC, telephone) and marks what it finds, without blocking. *(My call: the
  same warning a dossier gets before it is published.)*
- Persistent abuse: an admin deactivates the account (exists). A suspension from the Community alone is later (§9).
- **Not reachable through MCP.** No Community route enters `oauth/delegatedRoutes.ts`: a connected application can
  neither read nor write the Community, nor publish a D8 glossa into it. *(My call, a security one: an agent writing
  public replies in a user's name is a decision of its own.)*

## 6. Aggregating the discussions: the Community page

### 6.1 Where it lives

- **The exact placement is the other developer's decision** (G-309: the owner said «ok», then left it to them). The
  owner's «ok» settles that the glosse are the Community's subject; the routes are as below whatever is decided.
- **Recommended:** `/forum/community` is the feed, replacing S7a's placeholder in place (its `PageFrame`, its name
  «Community», its address). «Dossier pubblici» (`/forum`) keeps its three tabs for dossiers only; #205's tab is not
  built (§4). Gymnasium's courses in the Forum (A3) are a later neighbour, not a tab of the Community.
- `/forum/community/glossa/:threadId` — one glossa with its discussion.

### 6.2 What the feed lists

- **Every visible glossa**, on articles and on decisions, one card each: anchor label by the source convention
  (`articleLabel`, the server's `shortDecision` for a decision), the title or the passage's opening, an excerpt of the
  body (280 characters, cut at a word), author («utente cancellato» when null, §7.3), subject, votes, visible replies,
  «risposta accettata» mark, «modificata», «chiusa», last activity. No replies, no full body. Hidden glosse are left
  out; emptied ones (§5.5) are listed with their anchor and «Glossa cancellata dall'autore» while they have visible
  replies. D8 glosse are never listed (§2.3).
- **Order** (`sort`): «Attive» (`active`, last activity: the default *(my call; the interface's designer may choose
  another)*), «Recenti» (`recent`, opened), «Più votate» (`popular`), «Senza risposta» (`unanswered`, no visible
  reply, newest first). Ties fall back to the newest, then the id (#205).
- **Filters**, combinable as #205 allows (one of act / article-or-decision / court):
  - **kind**: articles or decisions;
  - **act**: the user types a citation, the web resolves it with its parser to `buildNormaKey`, server `act` (every
    article of that act);
  - **one article or one decision**: `normaKey` (the web's `buildItemKey`, or a decision's key) — the address the
    reader's «Apri nella Community» uses (§6.4);
  - **court**: `court` (#205);
  - **subject**: `materia` (new). Chosen by the author in the composer from the five subjects, optional; the web
    pre-selects it for the codes it can map (c.c. and its procedure, c.p. and its procedure, the codice del processo
    amministrativo), never for a law, a decree or a decision. The author can change it later (an edit). Glosse without
    a subject are listed under «Tutte» only. This is the «column the author fills» #205 named. *(My call; it needs
    the migration.)*
  - **mine**: «Le mie glosse»;
  - **participated** (new): «Dove ho risposto», glosse with a visible reply or comment of the reader;
  - **accepted=false** (new): answered, not settled (§5.3).
- **Pagination**: `page` and `limit` (1–50, default 20), with the total, as #205 and the per-article list do. Offset
  pages may shift by a row while people write; with this community's size that is acceptable, and the stable
  tie-break keeps a page from repeating a row within one ordering *(my call: a cursor is a later change of one
  function)*.

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
| notifications | `GET /forum/notifications`, `POST /forum/notifications/read { ids \| all }`; the count in the existing 30 s poll (`GET /notifications/forum-unread-count`, `hooks/useForumNotifications.ts`, into the Forum's `total`) | new + changed |
| moderation | report queue, resolve, hide, lock, appoint | new |
| licence | `GET /lingo/testi/CONTRIBUTO_COMMUNITY` (the existing text route) and acceptance with the first write | new key |

### 6.4 Beside an article or a decision, in the reader

- **Today**: the reader's toolbar opens «Glosse sull'articolo» (`ArticleDiscussionPanel`); the passage signs count the
  glosse on a block and open them. A decision's reader does the same (`DecisionReadingSurface`).
- **This design adds**, in pull request 2c together with the strict rules, so the panel never breaks (§9): on each glossa in the panel
  «Apri nella Community» (its page), the «risposta accettata» mark, «modificata», «chiusa», the author's edit and
  delete, a report reason from the closed list, the licence on a 409, no vote on one's own content and no reply to a
  comment. At the panel's head, «Tutte le glosse di questo articolo nella Community» (the feed filtered on
  `normaKey`). Accepting an answer is the Community page's, not the panel's. *(My call: the panel stays a full place to
  discuss; G-304 makes the two one conversation.)*
- From the Community, «Apri nel testo» (#205's `glossaLinks.ts`: an article through its recorded URN and
  `triggerSearch`, a decision by its `/sentenze/…` address) opens the text. Focusing the passage in the reader stays
  #205's next step.
- The dossier's article reader shows no Forum glossa today and this design does not add one *(my call: a dossier is
  private work; the D8 column is there)*. The decision reader keeps showing both (§2.2), with the words of §2.5.

### 6.5 Notifications

Written in the same transaction as the event, to:
- the glossa's author, for a new reply (`reply`);
- a reply's author, for a comment under it (`comment`) and for its acceptance (`accepted`);
- the author of anything hidden by moderation (`hidden`, with the reason's category, never the moderator's name).

Never for one's own act. In the app only: the Forum's badge (`total` of `useForumNotifications`, read from the
existing `GET /notifications/forum-unread-count`, which adds the unread Community notifications) and a list in the
Community page; moderators also see the count of pending reports there. No e-mail (VisuaLex sends none today). Read
ones are deleted after 90 days *(my call)*.

## 7. Privacy and licence

### 7.1 Public by the author's choice

A glossa or a reply is published by its author's act, and visible to every signed-in user under their username; never
to anonymous visitors in this cut. The composer says so before the first write: #205's notice («Le glosse sono
pubbliche nel Forum: per un appunto privato usa una nota»), extended to replies («Le risposte sono pubbliche nella
Community»), and the licence's text (§7.2) is accepted then. Nothing private becomes a glossa by itself: a note, a
highlight, a dossier or a D8 glossa (§2.4) reaches the Community only if its owner writes or publishes a glossa.

### 7.2 Licence (G-283, G-310)

G-283 recommended CC BY-SA 4.0 for the community's contributions, and the owner confirmed it for the Community (G-310).
This design makes it concrete: a versioned text `CONTRIBUTO_COMMUNITY` (a new key of `LingoTestoChiave`, administered
like `PROPOSTA_SCHEDA`). Its version 1 is written by the second migration (§9), in words the owners approve before it
is applied (drafted with the plan), so there is never a moment without a text. It works as a card's proposal does: a
glossa, reply or comment whose author has not accepted the **current** version carries that version's id or gets 409
with the text (`{ detail, richiedeTesto }`), nothing written; a new version asks again. Every contribution records
the version it was written under (`licence_text_id`), so what is under the licence is known row by row. Accepting it
licenses what one writes from then on. What was written before (`licence_text_id` null) stays visible inside VisuaLex
as it is today, and is not relicensed silently. *(My calls: version 1 in the migration, a new acceptance per version,
the version on each row.)*

### 7.3 Deleting the account (G-307)

Today deleting an account deletes its glosse **with every reply others wrote under them** (cascade). The owner chose
(G-307, «c»): **the contributions stay, with their text, without an author**.
- `user_id` becomes null on the person's glosse, replies and comments (`ON DELETE SET NULL` replaces the cascade), and
  every view names the author «utente cancellato». What others wrote under them is never deleted.
- What goes with the account: their votes and their notifications. Their reports stay without a reporter (§5.1);
  the moderation log keeps each act with `actor_id` null.
- What the person had emptied (§5.5) stays emptied; an accepted answer stays accepted.
- An anonymous contribution can no longer be edited or deleted by anyone, and an anonymous glossa's acceptance can
  no longer change (§5.3); an anonymous reply can still be accepted by the glossa's author. Moderators can still hide
  it.
- **Before deleting**, the person can delete their contributions one by one (§5.5), and the deletion dialog says so:
  glosse, replies and comments stay, anonymous, unless deleted first; it links the Community filtered on «Le mie
  glosse» and «Dove ho risposto». **The privacy notice** (VisuaLex's, at its next version) must say the same:
  published contributions outlive the account, without the author's name.
- **Residual risk**: a text can identify its author by itself — a signature, a firm's name, a case only they handled,
  a recognisable style — and other people's replies may name their username. Making a contribution anonymous removes
  the link in the database, not what the words say. After the account is gone, the person can still ask the owners to
  empty a contribution: an admin empties it as §5.5 does, logged with the request as reason *(my call: erasure must
  stay possible after the account is gone)*.
- `deleteUserAccount` does it in its transaction: the `SET NULL`s do most of it, as for Gymnasium's community cards.
- A D8 glossa is a `highlights` row of the user's and goes with the account (cascade, unchanged).

### 7.4 Export

`GET /auth/export` already carries the person's glosse (with `repliesFromOthers`, a count) and their own replies and
comments, and no other user's id, name or text (G-306, fixed by #229, #236, #246). The Community adds: the new marks on
their glosse and replies (edited, deleted, accepted, subject, licence version), their votes (target ids), their
reports (reason, details, date) and their notifications. A report's `reported_text` is never exported: it is the
moderators' record. Nor is `locked_by` (a moderator's id): the export drops it from the glossa as it drops
`passageReleasedById` today (`authController.ts`, `exportAccountData`). The export's two-user test (#236) gains the new tables.

### 7.5 What leaves VisuaLex

Nothing. The Community sends no event to MERL-T and nothing to an AI in this cut; no MCP route reads it (§5.8).

## 8. Security notes for the builder

- Ownership is checked on every edit, delete and accept against the session's user (IDOR); a hidden or deleted item
  answers like a missing one to whoever may not see it.
- A contribution may have no author (§7.3): every view and check handles a null `user_id` (today `threadView` calls
  `userView(thread.user)` and `listPassages` the same, which would throw), and a null author is never anyone's own.
- Moderator and admin rights are read from the database on each call; `requireAdmin` stays for admin-only acts.
- Body rendering: §5.4.
- Every new route answers its 400/403/404/409/429 in Italian through `parseItalian`, which is private to
  `articleDiscussionController.ts` today: moderation and notification routes in other files need it exported.
- No route reachable by an exchanged token (§5.8).

## 9. Order of work, size, migrations

**First cut**, in this order, each a pull request into `develop` with its review. Sizes are rough (S < 300 lines of
change, M < 1,000, L above, tests included).

0. **Web, the word (S)** — after the owners' answer to §2.5: `GLOSS_WORDS` and, if B, the places listed in §2.5's row B. Independent of the rest; before 3.
1. **Server, data (M)**, #383 — the two migrations, account deletion (§7.3), the reports' copy and its sweep (§5.7), the
   export's additions (§7.4), **and every existing view made safe for a null author** (`threadView`, `commentView`,
   `listPassages`: «utente cancellato», never anyone's own, §8). Without the views, the first account deleted after
   the foreign keys change would make every reader of that article a 500 until pull request 2.
2. **Server, routes (L)** — #205's feed and glossa route carried over with their tests (§4), replies at two levels,
   edit, delete, accept, reply reports, moderation queue and acts with the log, notifications, limits, feed filters.
   **Server only, and today's reader panel keeps working** (G-392 left the web for after the other developer's word;
   the orchestrator's call of 30 October): the four rules the panel cannot meet yet stay lenient, each pinned by a test
   of today's behaviour, and are **pending PR2c**:
   - the licence's 409 on a first write (§7.2): no check yet, `licence_text_id` stays null, like the older rows;
   - the closed report reasons (§5.7): a free reason (the panel sends «segnalazione») is read as `altro`, its text
     kept in `details`;
   - a reason for releasing or withholding a decision's quotation (§5.7): optional, logged without one;
   - the 403 on voting for one's own glossa or reply (§5.3): still allowed.
   The panel's two-level replies are no break: it only writes top-level replies.
2c. **Server and web, the strict rules and the panel (M)** — after the other developer's word on the wording: the
   four rules above turn strict, and the reader's discussion panel changes with them (§6.4): the licence dialog on a
   409, the menu of report reasons, the release's reason, no vote button on one's own content, and the rest of §6.4.
3. **Web, the Community (L)** — the feed at `/forum/community` and a glossa's page, the notifications list and badge,
   the moderation queue (in the admin page for admins, under the Forum for moderators). The other developer designs
   them in the Inchiostro language; this pull request waits for that design and wires the data to it. No mock-up
   exists today.

No switch: the Community replaces a placeholder, and every route is behind the login. *(My call; a switch
`forum_community` can be added in 2 if the owners want to ship 1–2 before 3.)*

**Migrations** (reserved 29 October 2026 in the owners' register; written in pull request 1):
- `20261031100000_community_licence_key` — `ALTER TYPE "LingoTestoChiave" ADD VALUE 'CONTRIBUTO_COMMUNITY'`: the
  second migration inserts version 1 of the text with that value, and a new enum value cannot be used in the
  transaction that adds it (`20261024100000`/`…01` did the same).
- `20261031100001_forum_community` — everything in §5.1, the report reasons moved to the closed list (§5.2), and
  version 1 of the licence's text (§7.2; its words are a draft the owners approve in pull request 1's review). The closed lists are SQL `CHECK`s, as the discussion tables' existing
  ones (report `reason`, `hidden_reason`, the log's `action` and `target_kind`, the notifications' `kind`), and every
  new `SET NULL` column has its index (`locked_by`, `resolved_by`, `actor_id`, the reporters' `user_id`).

Both are written by hand and applied with `migrate deploy` (never `migrate dev`, which proposes to reset the database).

**Later**
- Publishing a validated D8 glossa (or postilla) to the Forum, as a copy by the user's act (§2.4): web, medium — the
  dossier's reader has no Forum composer today, and the passage must be located again in the article as the main
  reader projects it.
- The other developer's idea: a dossier attached to a discussion; AI drawing ordered glosse from a debate, valid only
  once the participants validate them (§12).
- Edit history visible to moderators; suspension from the Community; auto-hiding past a threshold; muting a glossa's
  notifications; e-mail digests; mentions; a cursor for the feed.
- Votes and accepted answers as inputs to points, levels and authority (G-303's spec).
- Reading without an account, after the decision on opening VisuaLex to the public.
- Structured citations in a reply (a chip with a stored key, labelled by the convention).

## 10. Calls made in this design

Marked *(my call)* in the text: two levels of replies; reply and comment lengths; the order of replies; no votes on
comments and none on one's own content; `accepted=false` next to `unanswered`; an explicit `last_activity_at`, which edits do not move; a subject change
not marked «modificata»; an anonymous reply still acceptable;
emptied text is not kept; deletion outside the trash; closed report reasons; one decision per reported item; no
automatic hiding; the daily limits and their 24-hour window; the personal-data check in the composer; no MCP access;
the feed's default order; offset pages; the subject column and its pre-selection; notifications kept 90 days; existing
data left as stored; the moderator's free reason kept to the log, a category shown to the author; the licence's
version 1 in the migration, a new acceptance per version and the version on each row; the reader's panel kept
complete and changed with the strict rules (2c); no Forum glossa in the dossier's article reader; reports outliving their
reporter's account and their item; an admin emptying an anonymous contribution on request; the reported text's sweep once a day; a
published D8 glossa as an unlinked copy; carrying #205 into pull request 2; no switch.

## 11. Verified against the code (29 October)

Read on `develop` at 6b1c3f90: `prisma/schema.prisma` (the discussion models, `Highlight`, `HighlightKind`,
`LingoTestoChiave`, `LingoMateria`); `routes/articleDiscussions.ts` and `controllers/articleDiscussionController.ts`
(routes, depth, votes, `reportThread`, `moderateThread`, `threadView`); `controllers/authController.ts`
(`exportAccountData`); `lingo/deleteUserAccount.ts`; `middleware/delegated.ts`, `middleware/rateLimiter.ts`,
`oauth/delegatedRoutes.ts`, `oauth/consent.ts`; `routes/lingoTesti.ts`; in the web `ForumCommunityPage.tsx`,
`ForumTabs.tsx`, `forumSections.ts`, `App.tsx`, `constants/glossWords.ts`, `utils/articleAnnotations.ts`,
`DecisionReadingSurface.tsx`, `DossierItemReader.tsx`, `hooks/useForumNotifications.ts`; in the MCP
`tools/glosses.ts`, `exchange.ts`; #205's branch against `develop` (`git merge-tree`).

An independent review read this revision against the same code. Its factual corrections are applied (the sign's
words, the counter's second place, #205's second conflict, the cross-references), and its design findings are
settled in the text: the null author before pull request 2 (§9), deciding and deleting under one lock (§5.5), an
explicit last activity (§5.1), reports that outlive their item (§5.1, §5.7), `locked_by` out of the export (§7.4),
the admin route and the log (§5.7), the moderators' reading of a quotation (§5.6).

## 12. The owners' answers, and what is still open

The owner answered on 19 October 2026; G-309 to G-312 also need the other developer's word.

| Question | Answer |
| --- | --- |
| G-306 The export hands over other users' replies: fix it now? | «ok»: done (#229, #236, #246; §7.4) |
| G-307 Account deletion | «c»: the text stays, without an author (§7.3) |
| G-308 Deleting what was reported | «ok»: a report keeps a copy for the moderators until 90 days after it is closed (§5.7) |
| G-309 Where the glosse live | «ok», the exact placement left to the other developer (§6.1) |
| G-310 Licence CC BY-SA 4.0, a versioned text accepted at the first write | «ok» (§7.2) |
| G-311 First cut: only discussions anchored on a norm or a decision | «ok» (§1) |
| G-312 Moderators' request and commitment outside the app | «ok» (§5.7) |
| G-392 (30 October) Q-1 to Q-6 below | «ok», as recommended: «postilla» for the assistant's note; a D8 note published only as the user's copy, with a mark; #205 closed after; a 24-hour window; no switch. Pull requests 1 and 2 start; 0 and 3 wait for the other developer |

**Still open: the other developer**
- G-309: the placement in the Forum. Recommended: `/forum/community` is the feed, in place of S7a's placeholder;
  «Dossier pubblici» keeps only dossiers (§6.1).
- G-310, G-311, G-312: their word on the owner's «ok».
- D8's question 5, the word: see Q-1.

**Questions of 29 October, answered by the owner on 30 October (G-392: «ok» to each recommendation); Q-1 also
waits for the other developer**
- **Q-1 · The word.** «Glossa» names the Forum's discussion and the assistant's note on a passage (§2). Recommended:
  option B, the Forum keeps «glossa» (D-076) and D8's note becomes «postilla» (§2.5). Needed before the Community's
  web (pull request 0 before 3).
- **Q-2 · A D8 glossa into the Forum.** May a user publish a validated assistant's note as a Forum glossa?
  Recommended: yes, later, as a copy the user reviews and publishes in the composer, theirs once published, never by an
  application, no link kept (§2.4). Not in the first cut.
- **Q-3 · Saying so.** If Q-2 is yes: does such a glossa say it began as an assistant's text? Recommended: yes, a
  plain mark under the author's name, chosen by the user and on by default; the owners weigh the legal side.
- **Q-4 · #205.** Recommended: close it once its server commits and tests are carried into pull request 2, and its
  composer notice and links into the panel's changes; its «Glosse» tab is not built (§4).
- **Q-5 · The daily limits.** Recommended: a 24-hour window from the first write, as the MCP's counters, rather than a
  Rome calendar day (§5.8). The numbers (10, 60, 20, 60) stay environment variables.
- **Q-6 · A switch.** Recommended: none; add `forum_community` only if the server pull requests ship before the web
  one (§9).

**Later, not needed for the first cut**: the AI step (a dossier attached to a discussion, glosse drawn from a debate) —
who answers for a glossa an AI drew, whether participants' replies may be read by an AI at all (MERL-T consent, the
forum-authoring decision), and who validates (all participants, a majority, each for their own part).
