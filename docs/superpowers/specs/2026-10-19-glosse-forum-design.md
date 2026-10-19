# Glosse in the Forum — the server side and a skeleton (proposal)

19 October 2026. Status: **proposal**, a draft pull request for the owner's morning review (G-260, release 1.9).
The interface and the experience are the other developer's, with Inchiostro; this round prepares the server and a bare tab.

## What the owner asked

A panorama in the Forum of the discussions that grow from comments on passages of articles: «una sorta di Reddit o
stack overflow del diritto». He separates two things:

- the **note** on an article — private, or published when the user puts it in a dossier;
- the **glossa** of the Forum — what the cloud icon opens. It never goes into a dossier and belongs to the Forum
  alone, though it shows on the other screens because it starts from the core (the reading surface).

Glosse are the existing `ArticleThread` model (anchored on an article's passage or a decision, with replies, votes
and reports). Until now they were listed one article at a time.

## What this round adds

**Server** (`apps/server/src/controllers/articleDiscussionController.ts`):

- `GET /api/article-discussions/feed` — every visible glossa of every article and decision.
  - Pages: `page`, `limit` (1–50, default 20).
  - Orders (`sort`): `recent` (opened), `popular` (votes), `active` (last activity), `unanswered` (no visible reply,
    newest first). Ties fall back to the newest, then the id, so pages never repeat a row.
  - Filters: `kind` (`article` | `decision`), `act` (the web's `buildNormaKey`: every article of one act) or
    `normaKey` (one article, the web's `buildItemKey`, or one decision's key). Not both `act` and `normaKey`.
  - An item: id, title, an excerpt of the body (280 characters, cut at a word), the keys, `articleLabel`,
    `articleUrn` (for «apri nel testo»), `target`, `decisionLabel` (the server's `shortDecision` of the key), the
    passage, the author as every discussion route gives it (`{ id, username }`), votes and whether the reader voted,
    the visible replies counted, `createdAt`, `lastActivityAt`, `isOwner`. No replies, no full body.
- `GET /api/article-discussions/:threadId` — one glossa with its visible replies (the per-article list's shape), plus
  `decisionLabel`, `commentCount`, `lastActivityAt`, `passageWithheld`. Hidden or missing: 404 «Glossa non trovata».
- Moderation (`PATCH /admin/article-discussions/:id`) no longer moves `updatedAt`: it is the thread's last activity,
  which a reply sets and an admin's hiding or release is not.
- `page` / `limit` that are not numbers are an Italian 400 on the per-article list too (they reached Prisma as `NaN`,
  a 500).

**Web** (`apps/web/src/components/features/bulletin/`): a tab «Glosse» in the Forum, `ForumGlosseView`, unstyled —
the feed, the four orders, article / decision, the pages, and «Apri nel testo» (`glossaLinks.ts`: an article from its
recorded URN through the search, as a study card's anchor opens; a decision by its `/sentenze/…` address).

## Decisions taken in this round (each open to the owner)

1. **A decision's quotation is withheld outside the reader.** The reader's panel hides a decision's quotation whose
   words the court has withdrawn, and fails closed while it cannot tell (apps/web/CLAUDE.md, «Passage
   discussions»). The feed and the glossa's route hold no text, so they cannot tell either: they send `quote: null`
   with `withheld: true` unless an admin released it, the reader wrote it, or the reader is an admin. This exposes
   *less* than the per-article route, which still returns the quotation, and is a first step towards the
   server-side withholding the web notes call a precondition for opening VisuaLex to the public. An article's
   quotation travels as it does today.
2. **«Materia» is not a filter yet.** A thread stores no subject, and none can be derived honestly from its key: a
   code's articles could be mapped (c.c. → civile, c.p. → penale), but a law, a decree or a decision says nothing of
   its subject. A filter by subject needs data: a column the author chooses, or a mapping by act that leaves most
   acts unclassified. The act filter (`act`) covers «the glosse on this code or law» meanwhile.
3. **No migration.** The feed reads the existing columns. Without a filter it sorts the whole table by
   `created_at` / `updated_at`; with a few hundred glosse that is nothing. An index on `(is_hidden, created_at)` and
   `(is_hidden, updated_at)` is the first thing to add when the table grows (a migration name is reserved in the
   coordination register first).
4. **«Apri nel testo» opens the article, not the passage.** Focusing the glossa in the reader (its words lit, the panel
   open on it) needs a pending «focus this thread» signal for the reading surface; it is the next step and the
   interface's design decides how it looks. Threads opened before `articleUrn` was stored cannot be opened from the Forum: the
   tab says so.

## The four questions for the other developer, and the room left for each

1. **What the Forum's view shows first.** The feed takes any order and filter, so the first screen is a choice of
   defaults in the web (`recent` today), not a server change.
2. **Which filters matter.** `kind`, `act` and `normaKey` exist; a court filter is a prefix of the decision key
   (cheap, same pattern as `act`); author («le mie glosse») is one `where`; subject needs data (decision 2).
3. **A «risposta migliore» chosen by the glossa's author, Stack Overflow style.** Not built. Room left: one nullable
   column `accepted_comment_id` on `article_threads` (foreign key to `article_comments`, `ON DELETE SET NULL`), a
   route `POST /article-discussions/:id/accept { commentId | null }` for the thread's author only (the comment must
   belong to the thread and be visible), one field in `feedItemView` and `threadView` (`acceptedCommentId`), and
   `unanswered` could then mean «no accepted answer» or stay «no reply» — a product choice. Every list builds its
   items in one function (`feedItemView`, `threadView`), so the field is added in one place each.
4. **A notice when a glossa is opened**: «Le glosse sono pubbliche nel Forum: per un appunto privato usa una nota»
   (the orchestrator's proposal). Purely web, in the panel's composer; nothing on the server. The feed's existence is what
   makes it true: before this round a glossa was visible only from its article.
