# VisuaLex Studia — the screens for study cards

**Status:** approved by the owner (7 October 2026), with decision 22 added at his request. No code yet.
**Plan:** `docs/superpowers/plans/2026-10-07-studia-cards-screens.md`.
**Builds on:** the foundation plan (`docs/superpowers/plans/2026-09-30-lingolex-foundation.md`: the card model, its states, the FSRS v4 engine, account deletion) and the MCP second round (`docs/superpowers/specs/2026-10-04-mcp-second-round-design.md` §6: the card routes, anchors given in words, the trash).

## 1. Why, and what was decided

The cards exist in the database, Claude can create them through MCP, and they appear nowhere in the web app except the dossier trash. Nobody can read, write, study or validate a card in VisuaLex. Two goals of the owners' workspace make that the next thing to build: a seed of validated cards per subject, written by the founders and validated by them and a few recruited graduates (D-066, D-067); and studying those cards with spaced repetition.

The interview of 7 October put 21 questions, each with a proposal, to the owner. His answer: «per il resto la spec di Visualex Studia va bene». He commented on no single question, so all 21 proposals stand as written. Four points are the other developer's to confirm, and are recorded here as provisional defaults: the validation threshold (decision 14), and three questions on the exam simulation (§11). Two texts the user must accept, the notice shown when proposing a card (decision 13) and the consent before the first simulation (§11, question 20), were approved as worded on 7 October, on one condition of the owner's: «fai in modo che questi testi si possano cambiare facilmente dalla schermata admin» (decision 22).

The product name on screen is **VisuaLex Studia** (D-064). Identifiers in the code (`Lingo…`, `lingolex_…`, `/api/lingo/…`) stay as they are until a rename of their own; nothing the user reads says «LingoLex».

## 2. Scope

Three pull requests of code after this one, in this order, each usable on its own:

| PR | What the user gets | Schema |
| --- | --- | --- |
| **A. My cards** | The «Studia» area with «Le mie schede»: list, filters, detail, create and edit by hand, delete to the trash. Under each article in the reader, the cards anchored to it and «+ Nuova scheda». Cards written by Claude are marked. | `LingoCard` gains its origin (two columns). |
| **B. Propose and validate** | «Proponi alla comunità» on a draft, with the licence notice. A validator role given by the admin. The «Da validare» queue. Validated cards counted and shown. | `LingoValidazioneCard`; `LingoTestoVersione` and `LingoAccettazioneTesto` (texts to accept, versioned, and who accepted which); `LingoCard.propostaTestoId`; `User.lingoValidatore`. |
| **C. Review** | The «Ripasso» view: today's cards one at a time, four grades with their intervals, a daily goal, community cards by subject. | `LingoStatoRipasso`, `LingoRevisioneSRS`, `LingoPreferenzeStudio` (the daily goal and the subjects). |

Out of scope: the exam simulation (its open answers are recorded in §11 and in the foundation plan's «Later»); the norm watcher that moves a card to «da rivedere»; RLCF weighting, authority and the «controversa» flag; offline use and installing the app; changes to the MCP tools beyond their user-facing wording.

## 3. Decisions

Approved by the owner on 7 October (interview questions in brackets), unless marked otherwise.

1. **Where cards live** (Q1). A new sidebar entry **«Studia»** at `/studia`, with three views: **Ripasso** (C), **Le mie schede** (A), **Da validare** (B, only for validators). In the reader, under each article, a row **«Schede su questo articolo (n) · + Nuova scheda»** that opens in place, as the notes do. Not «Studio»: «Modalità studio» already names the full-screen reading mode.
2. **Order** (Q2): A, then B, then C. Validation comes before review because the seed is measured in validated cards and Claude writes the drafts. Each PR is one round: tests first, review, browser pass.
3. **Words** (Q3). The object is a **«scheda»** («schede»), never «card» or «LingoLex». The trash shows «Scheda di studio» / «Schede di studio (n)». The MCP tools' titles and descriptions say «schede di VisuaLex Studia»; the tool names `lingolex_*` stay (D-064).
4. **Creating a card from an article** (Q4). «+ Nuova scheda» in the reader opens a form with:
   - the **primary anchor**: the article being read;
   - the **subject**, inferred from the act (codice civile → civile; codice penale → penale; codice di procedura civile and penale → the two procedural subjects; codice del processo amministrativo → amministrativo). For any other act it is chosen by hand;
   - the **institute**, suggested from the article's heading when the reader has one, and always editable;
   - the **kind** (Definizione, Distinzione, Caso, Requisito di forma: the four values of `LingoCardTipo`);
   - the **question**, the **answer** and an optional **explanation**;
   - **more anchors**, typed as references («art. 1454 c.c.») and checked by the server as today.

   A card's title is its institute and its primary anchor in the source convention's short citation: «Risoluzione per inadempimento · art. 1453 c.c.» (`citeNorm`, `utils/sources/normLabels.ts`). On a past text (`readOnly` / `versionInfo.isHistorical`) the button is disabled, with the reason in its tooltip: an anchor holds on the text in force. A card anchors to the **article** (URN and fingerprint), never to a passage, so root rule 23 does not reach it. Q4 also asked whether selecting a passage should offer «Crea scheda»; the blanket approval is read as yes, and the owner can drop it on reviewing this spec. The selection popup's «Crea scheda» opens the same form with the passage copied into the answer as plain text: it is the user's text from then on, and nothing ties it to an offset.
5. **Who edits what** (Q5). A **draft** is edited and deleted by its author, freely. A **proposed or validated** card is not edited: it belongs to the community; errors are reported through validation (decision 14). The author may **withdraw** a proposal: it goes back to draft.

   *Deviation for the owner's review of this spec:* Q5 allowed withdrawing only before the first vote. With decision 14 a «migliorabile» vote leaves the card proposed and shows the author the reason; if the author could not withdraw then, they could neither fix the card nor take it back. So the author may withdraw a proposed card **at any time while it is proposed**; its votes are deleted with the withdrawal, and a new proposal starts a new count. Validators lose their votes on that version, which is the point: the text they judged is about to change.
6. **Removing a draft** (Q6). Drafts can be reviewed without proposing them. «Elimina» sends a draft (or an archived card) to the trash for 30 days, as the MCP tool does; there is no «archived by me» state. This **changes an earlier rule** («the trash holds only what connected applications delete»; the web app's dossier deletions stay immediate): for cards, the web app's deletion goes through the trash too, recorded with no client (`clientId`/`clientName` null), and the trash row reads «Rimosso da te …».
7. **The review session** (Q7). One card at a time: the question; «Mostra risposta» (space bar); then the answer, the explanation and the anchors (each opens the article in a side panel without leaving the session); then four buttons, **Di nuovo / Difficile / Bene / Facile** (keys 1–4), each showing the interval FSRS would give («domani», «3 giorni», «8 giorni», «21 giorni»). The engine has no steps in minutes (foundation decision 10): «Di nuovo» schedules tomorrow, and the card also returns at the end of today's session until it gets another grade. Only the first grade of a card in a day is recorded for FSRS; the later passes of the same day are practice and are not sent.
8. **What enters review** (Q8): the user's own cards that are drafts, proposed or validated; the community's **validated** cards in the subjects the user switches on (a switch per subject in the Ripasso view, all off at first). Never a card «da rivedere» or archived.
9. **The daily goal** (Q9): **20 new cards a day** by default, editable; no cap on due reviews. The Ripasso view opens on «Oggi: 18 da ripassare · 20 nuove» and may be narrowed to one subject before starting (default: all). Requested retention 90%, not shown.
10. **«Le mie schede»** (Q10): the author's cards, **grouped by subject, then institute**. Each row: the title (institute · anchor), the state as a chip, and, from PR C, the next review date. Filters: subject, state, kind, «da ripassare oggi» (from PR C), act (any anchor on that act, e.g. every card on the c.c.), and a text search in the question and the institute. On a phone the list is one column and a card's detail opens full screen.
11. **Cards written by Claude** (Q11). A card records the connected application that created it, in two new nullable columns `createdByClientId` / `createdByClientName` on `LingoCard`, the same pair `DossierItem` has. A card created in the web app leaves them null. The list shows the dossier's mark «scritta da Claude Code (applicazione collegata)» (`ClaudeMark`, `dossierUtils.ts`) and offers the filter **«Scritte da Claude, da rileggere»**: a generated card deserves a look before it is proposed. The filter is origin = a connected application and state = draft.
12. **Community cards** (Q12) show the chip **«Validata»** and the count of approvals («validata da 3»), **without the author's name** (consistent with D-045: the author disappears at deletion anyway). The «controversa» flag waits for RLCF.
13. **Proposing** (Q13). «Proponi alla comunità» on a draft. Before the first proposal, a notice to accept (D-045, D-057). Its wording, **approved by the owner on 7 October** and seeded as version 1 of the text `PROPOSTA_SCHEDA` (decision 22):

    > **Proponi la scheda alla comunità**
    >
    > La scheda sarà pubblicata con licenza Creative Commons Attribuzione – Condividi allo stesso modo 4.0 (CC BY-SA 4.0): chiunque potrà leggerla, riusarla e modificarla, citandone la fonte e alle stesse condizioni.
    >
    > Se viene validata, la scheda resta anche se cancelli il tuo account: il tuo nome viene tolto, il testo no. Non scrivere nelle schede dati personali, tuoi o di altri.
    >
    > Finché è in attesa di validazione puoi ritirarla e tornerà una tua bozza.
    >
    > ☐ Ho letto e accetto — [Annulla] [Proponi]

    The acceptance records which version was accepted, and when. Once an administrator saves a new version, the notice is shown again **at the next proposal**: cards proposed before stay under the version accepted then, and each card records the version it was proposed under (`propostaTestoId`).
14. **Validators and the rule** (Q14). **Provisional default, to confirm with the other developer.**
    - Validators are the users an administrator marks as such (`User.lingoValidatore`, a checkbox in the admin's user page): the founders and the graduates of D-066.
    - A vote is **approvata**, **migliorabile** or **errata**; a reason is required unless the vote is «approvata».
    - An author never votes on their own card; a validator votes once per card.
    - A card becomes **validated with 2 approvals and no «errata»**. One **«errata»** archives it. A «migliorabile» leaves it proposed and the author sees the reason (not who gave it).
    - Votes are stored in the specification's `LingoValidazioneCard`, so RLCF's weighted sum (≥ 10 with at least 3 validators) can replace the rule later without losing a vote. The rule lives in one module (`lingo/validationRule.ts`) with its two numbers as named constants.
15. **«Da validare»** (Q15). A queue, one card at a time, with the anchored article open beside it (below it on a phone) and three buttons. The queue holds proposed cards the validator did not write and has not voted on, oldest first. It filters by subject; *the default is the subject the validator last chose*, remembered in the browser — Q15 said «the validator's own subject», but no subject is stored per validator, and storing one for a default is not worth a column (low-impact call, reversible).
16. **Phones** (Q16). Ripasso and Da validare are designed for the phone first: large buttons at the bottom, no swipe gestures. The rest is responsive like the dossier. No offline use and no installable app in this round.

Taken here, for the owner's review of this spec:

17. **Review scheduling is stored per user and card.** The specification has only the log (`LingoRevisioneSRS`). «Which cards are due today» would then mean «the latest review of every card», a scan that grows with every review. A second table, `LingoStatoRipasso` (one row per user and card: stability, difficulty, due date, last review, count of reviews and lapses), answers it with an index on `(userId, dueAt)`; the log stays, append-only, as the specification has it, so the weights can be fitted to the users' own reviews later (foundation decision 9).
18. **«A day» is the calendar day in Europe/Rome.** Elapsed days, «only the first grade of the day», the daily goal and «domani» all use it. The server decides, never the browser's clock.
19. **Validations outlive their author, anonymous.** The specification cascades a validator's votes with their account; the owner's rule for cards (D-045, «si mantiene la validazione») keeps them: `LingoValidazioneCard.utenteId` becomes null at deletion (`SET NULL`), so a validated card keeps the votes that validated it. A vote's reason is the validator's writing and may name someone: the same reservation as the card's text, to check before the beta. Reviews, review state and preferences are personal and go with the account.
20. **New state-machine arrow:** proposed → draft (decision 5). Every other arrow stays as the specification draws it.
21. **Matching a card to the article being read** uses the anchor's URN. The reader's `norma_data.urn` is a Normattiva address; the server cuts it at `urn:` exactly as `lingo/anchors.ts` does when it stores an anchor, in one shared function, and drops a version suffix (`!vig=…`, `@…`), which a stored anchor never has. An EU act has no URN anchor, so its articles show no row.
22. **Texts to accept live in the database, versioned, and the admin edits them** (the owner, 7 October: «per ora va bene, ma fai in modo che questi testi si possano cambiare facilmente dalla schermata admin», for both texts).
    - Each text has a key (`PROPOSTA_SCHEDA` in PR B; `CONSENSO_SIMULAZIONE` with the simulation, §11) and a series of versions: title, body, checkbox label, button label, when, and which administrator wrote it. The current text is the highest version.
    - Editing from the admin screen never overwrites: it **creates a new version**, and the old ones stay, readable in the admin screen. No route deletes a version, and the database refuses to (`Restrict` from acceptances and cards).
    - An **acceptance** records the user, the version and the time. A user who has not accepted the current version is asked again: for the proposal notice at their next proposal, for the consent before their next simulation.
    - The body is plain text. Paragraphs are separated by a blank line; no HTML or Markdown is interpreted, so an administrator's text cannot carry a script (§7).
    - Version 1 of each text is written by the migration that creates its key, with the wording the owner approved. Changing the wording later needs no release.

## 4. Data model

All migrations by hand (`prisma migrate diff`, never `migrate dev`), additive, and each in its own PR. The pull request descriptions say they touch the Prisma schema (and, for B, the `User` model).

**PR A** — on `lingo_cards`:

```prisma
  // The connected application that created the card (Claude Code, LibreLex), as on DossierItem.
  createdByClientId   String? @map("created_by_client_id")
  createdByClientName String? @map("created_by_client_name")
```

**PR B**:

```prisma
enum LingoGiudizio {
  APPROVATA
  MIGLIORABILE
  ERRATA
}

model LingoValidazioneCard {
  id          String        @id @default(uuid())
  cardId      String        @map("card_id")
  // Null once the validator's account is gone: the vote stays (decision 19).
  utenteId    String?       @map("utente_id")
  giudizio    LingoGiudizio
  motivazione String?       @db.Text
  createdAt   DateTime      @default(now()) @map("created_at")

  card   LingoCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  utente User?     @relation(fields: [utenteId], references: [id], onDelete: SetNull)

  @@unique([cardId, utenteId])
  @@index([utenteId])
  @@map("lingo_validazioni_card")
}

enum LingoTestoChiave {
  PROPOSTA_SCHEDA
}

// A text the user must accept (decision 22). Never updated, never deleted: an edit is a new version.
model LingoTestoVersione {
  id        String           @id @default(uuid())
  chiave    LingoTestoChiave
  versione  Int
  titolo    String
  corpo     String           @db.Text
  conferma  String           // the checkbox, e.g. «Ho letto e accetto»
  azione    String           // the button, e.g. «Proponi»
  createdAt DateTime         @default(now()) @map("created_at")
  // The administrator who wrote it; null for version 1 (written by the migration) or once that account is gone.
  autoreId  String?          @map("autore_id")

  autore       User?                    @relation(fields: [autoreId], references: [id], onDelete: SetNull)
  accettazioni LingoAccettazioneTesto[]
  carte        LingoCard[]

  @@unique([chiave, versione])
  @@map("lingo_testi_versioni")
}

model LingoAccettazioneTesto {
  id         String   @id @default(uuid())
  utenteId   String   @map("utente_id")
  testoId    String   @map("testo_id")
  acceptedAt DateTime @default(now()) @map("accepted_at")

  utente User               @relation(fields: [utenteId], references: [id], onDelete: Cascade)
  testo  LingoTestoVersione @relation(fields: [testoId], references: [id], onDelete: Restrict)

  @@unique([utenteId, testoId])
  @@map("lingo_accettazioni_testi")
}
```

on `LingoCard`: `propostaTestoId String? @map("proposta_testo_id")`, the version of the notice the card was proposed under (`Restrict`; null for a draft, cleared on withdrawal); and on `User`: `lingoValidatore Boolean @default(false) @map("lingo_validatore")`, plus the back-relations. The migration inserts version 1 of `PROPOSTA_SCHEDA` with the wording of decision 13. `pesoAuthority` from the specification is left out until RLCF: a column nobody writes would read as a weight of 0. With `utenteId` nullable, Postgres treats nulls as distinct, so anonymous votes never collide on the unique index.

**PR C**:

```prisma
model LingoStatoRipasso {
  utenteId     String   @map("utente_id")
  cardId       String   @map("card_id")
  stability    Float
  difficulty   Float
  dueAt        DateTime @map("due_at")      // the Europe/Rome day the card is due, at 00:00 local
  lastReviewAt DateTime @map("last_review_at")
  reps         Int      @default(1)
  lapses       Int      @default(0)

  utente User      @relation(fields: [utenteId], references: [id], onDelete: Cascade)
  card   LingoCard @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@id([utenteId, cardId])
  @@index([utenteId, dueAt])
  @@map("lingo_stato_ripasso")
}

model LingoRevisioneSRS {
  id            String   @id @default(uuid())
  utenteId      String   @map("utente_id")
  cardId        String   @map("card_id")
  dataRevisione DateTime @default(now()) @map("data_revisione")
  rating        Int      // 1 = Di nuovo, 2 = Difficile, 3 = Bene, 4 = Facile
  scheduledDays Int      @map("scheduled_days")
  stability     Float
  difficulty    Float
  durataMs      Int?     @map("durata_ms")

  utente User      @relation(fields: [utenteId], references: [id], onDelete: Cascade)
  card   LingoCard @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@index([utenteId, cardId, dataRevisione])
  @@index([utenteId, dataRevisione])
  @@map("lingo_revisioni_srs")
}
```

and the user's study preferences:

```prisma
model LingoPreferenzeStudio {
  utenteId        String         @id @map("utente_id")
  nuoveAlGiorno   Int            @default(20) @map("nuove_al_giorno")   // 1–200
  materieComunita LingoMateria[] @default([]) @map("materie_comunita")
  updatedAt       DateTime       @updatedAt @map("updated_at")

  utente User @relation(fields: [utenteId], references: [id], onDelete: Cascade)

  @@map("lingo_preferenze_studio")
}
```

A community card's review rows belong to the reviewer and cascade with the card: if a validated card is ever deleted, the reviews of it go with it.

## 5. Server

Every route below sits behind `authenticate` and is the user's own session's. None is added to the delegated table (`oauth/delegatedRoutes.ts`), so an exchanged token (Claude, LibreLex) cannot reach them: MCP keeps exactly the four card routes it has. Bodies are `.strict()` Zod schemas; the author, the state, the counts and the validator come from the session and the database, never from the body.

**PR A** (`routes/lingoCards.ts`):

- `POST /api/lingo/cards` — unchanged contract. Under an exchanged token it now stores `req.delegation.clientId/clientName` on each card; from the web app they stay null.
- `GET /api/lingo/cards` — gains `tipo`, `normaKey` (the act), `q` (case-insensitive contains on question and institute, 1–100 characters), `origine=applicazione` and `ordine=materia` (subject, institute, then newest: the order that keeps groups together across pages). The response adds `origine: { clientName } | null` to each card. Same limits (1–100, default 50).
- `GET /api/lingo/articolo?urn=…` (its own small router, `routes/lingoArticolo.ts`) — the cards anchored to that article that the user may see: their own (any state but archived) and the community's validated ones (from PR B, with their approval count). The URN is normalised (decision 21). At most 50, own first.
- `PATCH /api/lingo/cards/:id` — edits a **draft** of the author's: subject, institute, kind, question, answer, explanation, and the anchors given again as references (resolved and fingerprinted like on creation; the same cost caps). A card that is not the author's answers 404; one that is not a draft, 409. Anchors are replaced as a whole in the same transaction.
- `POST /api/lingo/cards/trash` — open to the user's session too (decision 6). Under a session the deletion is recorded with no client; under a token, as today. The rule that only drafts and archived cards move is unchanged.
- `lingo/anchors.ts` exports the URN normaliser that both the anchors and `/api/lingo/articolo` use.
- Why not `/api/lingo/cards/articolo`: the delegated table's matcher reads any single segment after `/lingo/cards/` as `:id`, so that path would be open to exchanged tokens through the `GET /lingo/cards/:id` entry. New paths stay out of that shape; a test pins 403 for a token on each.

**PR B**:

- `GET /api/lingo/testi/:chiave` — the current version of a text (`id`, `versione`, `titolo`, `corpo`, `conferma`, `azione`) and whether the caller has accepted it.
- `POST /api/lingo/cards/:id/proponi { accettoTestoId?: string }` — draft → proposed, the author's only. If the caller has accepted the current version of `PROPOSTA_SCHEDA`, no body is needed. Otherwise `accettoTestoId` must be that current version's id: the acceptance is stored in the same transaction. Anything else (no id, or an older version's because an administrator saved a new one meanwhile) answers 409 with `{ richiedeTesto: <the current version> }`, which the web app shows. The card records the version in `propostaTestoId`.
- `GET /api/admin/studia/testi` — administrators only: for each key, every version, newest first, with its author's username.
- `POST /api/admin/studia/testi/:chiave { titolo, corpo, conferma, azione }` — administrators only: saves a new version, numbered one above the highest (two administrators saving at once: the unique index refuses the second, which answers 409 «Un'altra versione è stata salvata nel frattempo: ricarica»). Lengths: title 200, body 8,000, checkbox and button 120.
- `POST /api/lingo/cards/:id/ritira` — proposed → draft, the author's only; deletes the card's votes and clears `propostaTestoId` in the same transaction.
- `GET /api/lingo/cards/:id` — for the author, adds the reasons of the «migliorabile» and «errata» votes, without who gave them, and the approval count.
- `GET /api/lingo/validazione/coda?materia=&limit=` — validators only (403 otherwise): proposed cards not written by the caller and not yet voted on by the caller, oldest first, with their anchors; at most 20 a page.
- `POST /api/lingo/validazione/:cardId { giudizio, motivazione? }` — validators only; 404 if the card is not proposed, 403 on one's own card, 409 on a second vote. In one transaction (the card row locked, `FOR UPDATE`): the vote is stored, then `validationRule.ts` decides the card's state (decision 14). The response says the card's new state.
- `PUT /admin/users/:id` — accepts `lingoValidatore`.
- `cardStates.ts`: the arrow proposed → draft.

**PR C** (`routes/lingoSrs.ts`, mounted at `/api/lingo/srs`, as the specification names it):

- `GET /api/lingo/srs/sessione?materia=` — today's queue: the due cards (`dueAt` ≤ today, oldest due first), then new cards up to what is left of the daily goal (new = in the user's scope with no `LingoStatoRipasso` row; new cards already introduced today count against the goal, across devices). Each card carries the four intervals FSRS would give (`anteprima: { 1: days, 2: …, 3: …, 4: … }`), computed with `srs/fsrsEngine.ts` on the server. Also the counts for «Oggi: 18 da ripassare · 20 nuove». Scope as decision 8.
- `POST /api/lingo/srs/revisioni { cardId, rating, durataMs? }` — records a review: the card must be in the user's scope (404 otherwise). If the card was already graded today, nothing changes and the answer is `{ registrata: false }` (decision 7). Otherwise, in one transaction, the engine's `review(previous, rating, elapsedDays)` with the elapsed whole days in Europe/Rome; the state row is upserted, and the log row appended.
- `GET` / `PUT /api/lingo/srs/preferenze` — the daily goal (1–200) and the community subjects.
- `GET /api/lingo/cards` gains `dovuteOggi=true` and each card its `prossimoRipasso` for the caller.

**Account deletion and export.** `lingo/deleteUserAccount.ts` stays the one path. With the foreign keys above, deleting the user removes their acceptances, preferences, review state and reviews (cascade) and anonymises their votes and the text versions they wrote (`SET NULL`); the function itself still removes drafts and archived cards first. `GET /api/auth/export` adds `data.lingoValidazioni` (the user's votes with the card id, the verdict and the reason) and `data.lingoAccettazioni` (key, version and time of each text accepted) in PR B, and `data.lingoRipassi` (the review log) and `data.lingoPreferenze` in PR C. The payload stays at `schemaVersion` 1: keys are added, none changed.

## 6. Web

**Structure.** A lazy route `/studia` in `App.tsx` with three child routes, `ripasso`, `schede`, `valida`, and `/studia` redirecting to `ripasso` once PR C lands (to `schede` before). A sidebar `NavItem` «Studia» with a `GraduationCap` icon, after «Dossier». A feature flag `VITE_FEATURE_STUDIA` (default on), built like the MERL-T flags, so the area can be hidden in a deployment. Code lives in `components/features/studia/`, with its service `services/studiaService.ts` and a hook per view; the cards are server state fetched per view, **not** in `useAppStore`'s persisted state (the store is already 3,000 lines, and nothing here is needed offline).

**Reader.** In `ArticleTabContent`, after the notes and before `BrocardiDisplay`, a single quiet row «Schede su questo articolo (3) · + Nuova scheda» (`ArticleCardsRow`). The count comes from `/api/lingo/articolo`, fetched when the article is shown, cached for the session per URN. Clicking the count opens a Peek (the notes' pattern: header, scrollable list, no composer): each card's question, its state chip, «Validata da n» for community cards; a card opens its detail in the Studia area. «+ Nuova scheda» opens the form: a `Modal` on desktop, a bottom sheet on a phone (`useIsDesktop`, like `AddToDossierPopover`). `SelectionPopup` gains «Crea scheda» (decision 4). The row is absent for an EU act and disabled for a past text.

**The form** (`CardForm`) is shared by create and edit: subject (`FormSelect`), institute, kind (`SegmentedControl` on desktop, select on a phone), question, answer, explanation (plain `textarea`s with the schema's limits counted down), and the anchors as chips: the primary one fixed when created from the reader, «+ Ancora» to type a reference. Errors from the server's anchor check are shown on the chip that failed, in the server's words.

**Le mie schede.** A sticky filter row (subject, state, kind, act, search, «Scritte da Claude, da rileggere», and from C «Da ripassare oggi»), then the groups: a subject heading, then institute sub-headings following the dossier's accordion pattern (`DossierActBlock`), then one row per card. Desktop: list and detail side by side; phone: the detail full screen with a back button. The detail shows the question, answer, explanation, anchors (each opens the article in the reader), the state, the origin mark, the validators' reasons (B), and the actions the state allows: Modifica, Proponi, Ritira, Elimina (`ConfirmDialog`, variant danger, «La scheda va nel cestino per 30 giorni. Le altre schede non sono toccate.»). An empty list is an invitation: «Nessuna scheda ancora. Aprine una da un articolo con “+ Nuova scheda”, o chiedi a Claude di scriverne.»

**Da validare** (B). One card at a time: the card on the left (title, question, answer, explanation, its anchors), the primary anchor's article on the right, read-only (the reader's article component, as the dossier embeds it); on a phone the article is a collapsed section under the card. At the bottom, three buttons, Approvata / Migliorabile / Errata; the last two open a required reason field before sending. After the vote the next card slides in; «Nessuna scheda da validare in questa materia» when the queue is empty.

**Ripasso** (C). Before starting: the counts, the subject filter, the community-subject switches and the daily goal (a small settings disclosure). The session: decision 7's screen, full height on a phone, the four grade buttons pinned at the bottom with a 44 px target; keys space, 1–4 and Esc (registered in `KeyboardShortcutsModal`). The article of an anchor opens in a side panel on desktop, a sheet on a phone. At the end: how many reviewed, how many again, when the next ones are due.

**Visual direction.** Studia lives inside VisuaLex and keeps its system: slate neutrals, the `primary` scale, dark mode through `.dark`, `StatusChip`, `EmptyState`, `ConfirmDialog`, 44 px targets, the z-index bands. One element carries the identity: **the card in review reads like the law it rests on.** Question and answer are set in the reader's serif (the `.vlx-art` face and leading), left-aligned, at most 60 characters a line, the question one step larger than the answer; the anchor citation sits above the question in the interface's sans, small, in slate, as a source line, not a label. Revealing the answer is the one motion of the area: a hairline rule draws across and the answer unfolds beneath it (about 180 ms, none with `prefers-reduced-motion`). Everything around it is quiet: no shadows or gradients on the card, no coloured grade buttons except «Di nuovo», which takes the warning tone; the interval is the large text on each button and the grade the small one, because the interval is what the user decides on. State chips map onto existing tones: draft slate, proposed primary, validated success, «da rivedere» warning, archived muted slate. Lists are rows under headings, as in the dossier, not a grid of cards.

**Copy.** Sentence case, Italian, verbs that say what happens and the same word through a flow: «Proponi» → toast «Scheda proposta alla comunità»; «Ritira» → «Proposta ritirata: la scheda è di nuovo una bozza»; «Elimina» → «Scheda nel cestino». Errors say what failed and what to do («L'articolo 99999 c.c. non esiste: correggi l'ancora»), never apologise.

**Admin** (PR B). The admin page gains a section «Testi di VisuaLex Studia»: for each text, the current version in a form (title, body, checkbox label, button label) with a preview as the user will see it, and «Salva come nuova versione», confirmed through `ConfirmDialog` («Si crea la versione n+1. Chi ha accettato una versione precedente la vedrà di nuovo alla prossima proposta. Le versioni precedenti restano consultabili.»). Below, the earlier versions, newest first, each with its number, date and author, opening read-only. The user list gains the checkbox «Validatore di VisuaLex Studia».

**Texts to accept** are shown by one component, `AcceptTextDialog`, from the server's version: title, the body split into paragraphs on blank lines as plain text, the checkbox with the version's label, «Annulla» and the version's button. Nothing about their wording is in the web app's code.

**Trash.** `TrashEntryRow` says «Scheda di studio» / «Schede di studio (n)»; `trashWhen` says «Rimosso da te» when the entry has no client.

## 7. Security

- **Authorisation on every id** (OWASP A01). Card routes filter by `autoreId = session user` for anything but reading validated community cards; the validation routes check `lingoValidatore` from the database on each call (never from the token), refuse one's own card and a second vote. Tests for each refusal.
- **No new delegated surface.** The new routes are absent from the delegated table, so an exchanged token answers 403 there; a test pins it for each new path.
- **Mass assignment** (A04/A08). Strict schemas; state, author, counts, origin and validator flag never come from a body except `lingoValidatore` on the admin's route.
- **Who writes the texts to accept.** Only administrators (`AdminRoute` on the web, the admin check on the server), each version stamped with its author; a user can neither create nor alter a version, only accept the current one by its id.
- **Stored text** (A03). Question, answer, explanation, reasons and the texts to accept are plain text, rendered as React text nodes; no Markdown, no HTML. A test renders a card whose question is `<img src=x onerror=alert(1)>` and finds the literal text.
- **Cost.** The anchor checks on create and edit keep today's caps (10 anchors a card, 20 distinct references a call). Votes and reviews are cheap database writes; the existing per-user rate limiter covers them.
- **Personal data.** Votes' reasons and cards' texts may name people (decision 19 and D-045's reservation); the notice tells the author not to write personal data. The export carries everything of the user's.

## 8. Testing

- **Server** (one suite run at a time; it resets the shared test database): each route's happy path and every refusal above; the validation rule as a pure table (2 approvals, 1 errata, migliorabile, withdrawal resets); the review day boundary in Europe/Rome (a review at 23:59 and one at 00:01 are different days; a daylight-saving night); «only the first grade of the day»; the daily goal across two «devices» (two sessions); account deletion keeps votes anonymous and removes reviews and acceptances; a new version of the notice asks again at the next proposal and leaves earlier proposals untouched; two versions saved at once; a non-admin refused on the admin text routes; the export's new keys; the delegated table's refusals; the migration drift check.
- **Web** (Vitest, Testing Library, services mocked with `vi.mock`): the form (inferred subject, disabled on a past text, server anchor errors on the right chip); the list's grouping and filters; the reader row's count and Peek; the notice flow (409 → notice → accept → proposed); the review session's keyboard flow and the requeue of «Di nuovo»; the text-node XSS case; the trash wording.
- **Browser pass** on `http://localhost:5173` for each PR, on desktop and at phone width, light and dark.

## 9. What changes elsewhere

- `apps/mcp`: the user-facing titles and descriptions of the four card tools say «schede di VisuaLex Studia» (PR A). Behaviour unchanged.
- `apps/server/CLAUDE.md`: the card routes, the trash rule for the web app, the validation and review routes, the deletion and export keys.
- `apps/web/CLAUDE.md`: the Studia area, its folder, the reader row, and the visual rule of the review card.
- The foundation plan's «Later» section records the simulation answers (§11), and its decision 14 loses «two readings to confirm» (confirmed on 2 October).

## 10. Open, with the other developer

- **The validation threshold** (decision 14): the 2-approvals rule is provisional. Changing it is two constants in `validationRule.ts` and their tests.
- The four simulation points in §11 marked so.

## 11. The exam simulation: answers of 7 October

Not built in this round; recorded so the simulation's own spec starts from them. Already decided before (2 October, unchanged): the simulation happens in VisuaLex's editor; during it the reader shows norms and case law only; the AI correction comes at once, marked «non verificata».

- **Duration (Q17).** Chosen per simulation, with the legal duration as default. *To confirm with the other developer:* the legal duration on the text in force, and whether the opinion and the act are sat on the same day.
- **Editor (Q18).** Free text with optional headings the correction recognises; pasting more than 1,000 characters at once stays blocked. *To confirm with the other developer:* whether the real exam is written by hand or on a computer.
- **Lost connection (Q19).** Time runs and the text is restored; an administrator may grant an extension for a documented failure.
- **Who reads an essay, and its fate (Q20).** The candidate, the assigned correctors, and administrators with every access logged. Essays are detached from the account and kept with their correction (D-058). Explicit consent before the first simulation, with the wording below, **approved by the owner on 7 October**. It lives in the store of decision 22 under the key `CONSENSO_SIMULAZIONE`, which the simulation's own PR adds (one `ALTER TYPE … ADD VALUE` and version 1 seeded by its migration), editable from the admin screen like the proposal notice. When an administrator saves a new version, the user is asked again **before their next simulation**:

  > **Prima della tua prima simulazione**
  >
  > Quando consegni, VisuaLex Studia conserva l'elaborato insieme alla sua correzione, per migliorare le rubriche e le correzioni. L'elaborato viene scollegato dal tuo account: non sarà più associato al tuo nome. Il testo però resta com'è: non scriverci il tuo nome né dati che permettano di riconoscerti o di riconoscere altri.
  >
  > Lo leggono solo tu, chi lo corregge e, quando serve, un amministratore, e ogni accesso è registrato. Fino alla consegna puoi annullare la prova: l'elaborato viene cancellato.
  >
  > ☐ Ho letto e acconsento — [Annulla] [Inizia la simulazione]

- **Traces for the first corrections (Q21).** The Ministry's traces (D-071; those before the civil procedure reform marked «da attualizzare»), plus one new trace for each missing cardinal civil act, at least art. 700 c.p.c., which none of the 70 is. *To confirm with the other developer:* they choose the traces by hand, so the corrections can be compared.
