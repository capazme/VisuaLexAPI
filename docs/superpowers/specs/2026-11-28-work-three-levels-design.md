# Work in three levels, in the desktop app only: practice, proceeding, event

Status: proposed on 28 November 2026, for the owner's yes before any code. Local mode only. It builds on the local
mode of `2026-11-26-desktop-local-mode-design.md` (M1, PRs #757–#764) and fills the slot that spec leaves for «the
practices-as-folders and the local deadline register». The decisions it rests on:

- **G-621** (27 November): this work lives only in the desktop app. The web stays on the law and never invites a
  client's data; the app handles the sensitive work, locally, and is open source.
- **G-622** (27 November): the data structure is the one of the deadline workbook the owner uses at his firm, sent as
  an empty template. «Questa è la struttura dati, anche noi dobbiamo adattarci».
- **G-563**: scheduled jobs (alerts, digests) exist only in the desktop app.
- G-612–G-615 (today's server on one encrypted SQLite file, the porting line, local mode in the core first); G-514
  (a local profile); G-516 (a local MCP server, M6); D-105 (privacy by design); D-163 (synchronisation, later).
- **The owner's principle of 28 November** on the web as a pseudonymised mirror: «il web è quindi lo spazio dove
  vivono le pratiche pseudonimizzate. Dobbiamo fare in modo che si distinguano bene nella pratica i punti dove ci
  sono dati personali e i punti in cui non ci sono, così che il web possa essere un mirror sicuro». §11 designs it.
- **The web owner's answers of 28 November** to the questions of his brief, folded in where they apply and listed in
  «Answers of 28 November».

This document designs the backend. The screens are lexcraft-web's and wait for its owner (§ «For the web owner»).
The decisions still open are in «Decisions for the owners». Each fact is marked **[read]** in a source listed at the
end, **[measured]**, or **[estimated]**.

**What this repository holds and what it does not.** This repository is public. It holds the structure of the
firm's workbook (entities, fields, states, views) under G-622, and a computation engine written from the norms
themselves, read on Normattiva. It does not hold the template file, any row of it, its rule catalogue or its
formulas. Whether the firm's rules may be reused in public code is an open question (W1); until it is answered the
app ships with no term rule of its own.

## Risks first

1. **The linked workbook is plain text.** The app's database is encrypted (G-613), the `.xlsx` it keeps in step is
   not. If the lawyer keeps that file in Dropbox, OneDrive or iCloud Drive, the clients' data leave the computer,
   and so does the log sheet with every past value. The app says so before it links a file, and again when the
   path is inside a synced folder (§5.9).
2. **A deadline hidden in a branch is a missed deadline.** While two versions of the register exist, the alerts
   read every one of them, and also the workbook's rows the app has not reconciled yet (§6). No deadline may go
   silent because it sits in the «wrong» version.
3. **A term computed by an unvalidated rule is not a certain date.** Every rule starts unvalidated. The app computes
   and alerts anyway, so that nothing goes silent, but it marks the date as computed by an unvalidated rule until a
   lawyer validates the rule, and the validation is written in the practice's diary (G-622).
4. **The page must never choose a file.** A route that took a file path from the web page would let any page that
   reaches the local port read or write any file the user can. The path of a workbook comes only from the native
   dialog of the shell, over the shell's private channel (§5.8).
5. **Whatever Claude reads leaves the computer.** The local MCP server (M6) does not expose the register unless the
   lawyer turns it on for that client (§7.3).
6. **Notifications show on a locked screen.** Their text names no client by default (§6.3).
7. **A pseudonymised mirror is not anonymous.** Pseudonymised data remain personal data under the GDPR
   (art. 4(5), recital 26). In a lawyer's practice the real risk is identification from context: the court, the
   dates, the facts, a decision later published. The web mirror of §11 is personal data held by whoever hosts it.
   It needs a DPIA and a legal check before it is built, and it is never called anonymous.

## What the lawyer gets, and what the first version leaves out

**The first version** (stages 1–5 of §9):

- practices with readable codes (P-001), their proceedings (P-001-A, P-001-B) and their events (E-0001): hearings,
  deadlines and checks, each with a date written by hand or computed from another event by a rule;
- the term rules, the court holidays and the firm's lists, edited in the app;
- the computed views: the week, the month, the acts, the practice card, the alarms, by person and by area;
- alerts, while the app runs and, if the lawyer wants, from the moment he logs in;
- a linked Excel workbook kept in step both ways, with a log sheet, «Riallinea con Excel», and a divergent branch
  when someone writes in the app without reconciling;
- export to a new workbook and import from one, with a preview.

**Left out of the first version:**

- fees and invoices («Preventivi e parcelle») and insolvency claims («Fallimenti e passivo»), which the template has
  (§9);
- cloud connectors (WebDAV first, then the others of the owner's proposal) and synchronisation between computers
  (D-163, W10);
- colleagues writing in the same register through the app (G-570); today they share the workbook;
- the pseudonymised web mirror (§11), which waits for a DPIA and a legal check; the data classes and their marks are
  in the first version;
- formulas in an exported workbook: it carries values;
- a code format the firm chooses (2026/001);
- practices as folders of readable files (§8: the default is a read-only export, later);
- the register through the local MCP server (M6, §7.3);
- any term rule shipped by LexCraft (W1).

## Design

### 1. Where the local-only tables live

Every table of M1 exists online and locally: the local schema is derived from the server's (M1 §2). The tables of
this design must exist **only** locally (G-621). Three ways:

| | (A) In the server's schema, never mounted online | (B) A local fragment the derivation merges | (C) A second encrypted file |
|---|---|---|---|
| How | the models go into `prisma/schema.prisma`; Postgres gets empty tables; the routes are mounted only in local mode | the models go into `prisma/local/work.prisma`; `scripts/local-schema.ts` appends them to the derived schema | a second SQLite file with its own schema, client, key and migrations |
| Online database | holds tables shaped for client data, empty | unchanged | unchanged |
| Code | one client type; plain | the local client type for `src/work/`; the online type elsewhere | two clients, two migration chains |
| Links to dossiers | real foreign keys | real foreign keys (back-relations added by the derivation) | none: ids by hand |
| Risk | a route mounted online by mistake accepts client data | small | references that rot between files |

**Recommendation: (B).** The online schema never names a model of this design, so no mistake online can store a
client's data, and the local file keeps real foreign keys to dossiers and the local profile.

How (B) works:

- **The fragment.** `apps/server/prisma/local/work.prisma` holds the models and enums of §2, written by hand, in
  SQLite terms. It is the only hand-written schema of the local side.
- **Back-relations.** Prisma needs a relation field on both models. The fragment's two links to server models
  (`WorkRegister.user`, `WorkPractice.dossier`) need fields on `User` and `Dossier` that the server's schema must not
  have. The fragment declares them in a header the derivation reads, one per line:

  ```
  /// back-relation User.workRegisters WorkRegister[]
  /// back-relation Dossier.workPractices WorkPractice[]
  ```

  `deriveLocalSchema` inserts each into the named model of the derived schema, appends the fragment, and fails on a
  name it cannot place.
- **Tests:**
  - the server's `schema.prisma` names no `Work*` model, and the Postgres test database has no `work_` table after
    the migrations;
  - deriving twice gives the same file (M1's drift check, now with the fragment);
  - a back-relation line naming a model or a field that does not exist fails the derivation.
- **The code.** Everything of this design is under `apps/server/src/work/`.
  - It reaches the database through `src/work/db.ts`, which exports the same client as `lib/prisma.ts`, typed as
    the local client generated from the derived schema.
  - `src/local/main.ts` mounts its router; `app.ts` online never imports it.
  - The online type check excludes `src/work/`. The local CI job generates the local client first, then type-checks
    `src/work/` against it.
  - A test fails if a file outside `src/local/` and `src/work/` imports `src/work/`.
- **Dossiers and tasks stay as they are.** A practice hangs on a dossier (§2.2): the dossier keeps its sources,
  notes and highlights, and the practice adds the firm's data in a local-only table. Nothing of the dossier or of the
  tasks changes online. What the web does with its own practices and tasks is a question for the web owner (§ «For
  the web owner»).

### 2. The data model

All tables are local-only, named `work_*`, under the local profile. One set of practices, proceedings, events and
diary entries exists per **register** (§2.1), so that a branch is a register of its own. Rules, holidays and lists
are the firm's, and do not depend on the register.

Conventions:

- **A civil day is text, `YYYY-MM-DD`; a time is `HH:MM`.** M1 found DateTime defaults and the adapter's format
  comparing wrongly (M1 §2). A term is a civil day with no time zone, and text compares correctly as text. A CHECK
  holds the format.
- **Money is integer cents.**
- **Codes are the identity a workbook row is matched by.** They follow the template's format, confirmed by the web
  owner on 28 November: P-001, P-001-A, E-0001. A format the firm chooses comes later. Codes are unique per register
  and never reused once deleted. A deleted row goes to the trash, as every Work row does.
- **Every row has a `version`**, increased at each write, and `updatedAt`. The change log (§2.6) records each write.
- **Every field carries a data class** (personal, indirect, pseudonymisable, non-personal), written beside it in the
  schema and checked by a test (§11.1).

#### 2.1 Registers and branches

`WorkRegister`:

- `id`, `userId` (the local profile), `name`;
- `kind`: `main` (one per profile), `branch` (written in the app while diverged), or `excel` (a workbook's content
  read while diverged, read-only);
- `parentId`, `forkedAt`, `forkSnapshotId` (§2.7): where it separated;
- `state`: `active`, `merged` or `archived`. Nothing is ever deleted: a merged branch stays readable.

#### 2.2 Practice («Pratica»), P-001

`WorkPractice`, one per dossier per register:

- `registerId`, `dossierId`, `code`;
- `client`, `counterparty`, `counterpartyLawyer`, `counterpartyLawyerPec`;
- `responsible`, `collaborator`: from the persons list;
- `status`: active, in decision, waiting, suspended, closed («Attiva», «In decisione», «In attesa», «Sospesa»,
  «Chiusa»). A closed practice closes all its events for the views and the alerts.
- `outcome`, `quoteStatus` (to do, sent, accepted, not needed), `quoteAmountCents`, `notes`;
- `insolvencyProcedure`: a flag, kept for the later insolvency sheet.

Computed, never stored: the next event, its days left, the practice's alarm.

#### 2.3 Proceeding («Procedimento»), P-001-A

`WorkProceeding`:

- `registerId`, `practiceId`, `code`: the practice's code, a dash and a letter (A…Z, then AA);
- `type`: from the firm's list of proceeding types, each with its **area** (judicial, out-of-court, enforcement,
  insolvency: «Giudiziale», «Stragiudiziale», «Esecuzioni», «Fallimenti»);
- `rite`, `degree`, `subject`, `clientRole`;
- `court`: from the firm's courts list; `section`, `judge`, `docketNumber` (RG), `decisionNumber`;
- `valueCents`, `valueIndeterminable`, `costsAwardedCents`, `costsCollectedCents`;
- `status`: open or closed; `outcome`, `notes`;
- `summerSuspension`: yes, no, or not stated (§4.4).

#### 2.4 Event («Evento»), E-0001

`WorkEvent`:

- `registerId`, `proceedingId`, `code`;
- `type`: hearing, deadline or check («Udienza», «Scadenza», «Monitoraggio»); `title`;
- the date, in one of two ways, never both (a CHECK):
  - `date`, written by hand, with an optional `time`;
  - `originEventId` and `ruleCode`: computed from another event by a rule (§4). The origin must carry a date
    written by hand, so a term is never computed from a computed one.
- `manualOverride`: a date written by hand on a computed event, which wins, while the computed date stays visible
  beside it;
- `computedDate`, `computedBy`: the engine's result and the engine and rule versions that produced it, refreshed on
  every change of the origin, the rule, the proceeding's suspension or the holidays (§4.6);
- `mode`: in person, written («cartolare», art. 127-ter c.p.c.) or remote (art. 127-bis c.p.c.);
- `peremptory`, `responsible`, `noticeDays` (the alert threshold, 7 when empty), `toVerify`, `notes`;
- `status`: to do, draft, done, filed, accepted, held, postponed, not due («Da fare», «In bozza», «Fatto»,
  «Depositato», «Accettato», «Tenuta», «Rinviata», «Non dovuto»). The last six close the event. The set is fixed in
  the first version, because the alerts depend on which states close.
- `doneDate`: received or filed; `recheckOn`: for a check; `hearingOutcome`;
- `channel` (telematic filing or PEC), `receiptsComplete`, `receiptsArchived`, `receiptsArchivedOn`, and for an
  event that starts from a PEC notification, `receivedAtTime` (§4.5);
- `expectedAmountCents`, `paidAmountCents`: an instalment is a deadline with amounts.

#### 2.5 Rules, holidays, lists, diary

- **`WorkRule`.** It stores the rule in data, never in code:
  - `code`, `description`, `reference` (the norm or the source);
  - `direction` (forward, backward), `quantity`, `unit` (days, months, years);
  - `summerSuspension` (whether the suspension can apply), `holidayPolicy` (extend to the next working day, or
    anticipate to the previous one), `saturdayIsHoliday`;
  - `followsPostponement`: whether a term computed from a hearing moves with it when the hearing is postponed;
  - `validatedAt`, `validatedBy`, `notes`;
  - `origin`: the firm's, imported, or LexCraft's (none ships today, W1).
- **`WorkHoliday`.** `date`, `label`, `court` (empty for a national holiday).
  - The national ones are computed from `apps/server/src/tasks/italianHolidays.ts`, which already holds the fixed
    days, Easter Monday and 4 October from 2026, so the list never runs out.
  - A court's own day (its patron saint) is added by the firm, for that court only; whether it counts is the
    lawyer's choice (§4.3).
- **`WorkListItem`.** `list` (persons, courts, proceeding types with their area, rites, client roles, hearing
  modes), `value`, `position`, `extra` (JSON: a type's area). The template's list of courts is not seeded: each
  firm writes its own.
- **`WorkDiaryEntry`.** `registerId`, `practiceId`, `date`, `author`, `text`, `kind` (note, outcome, rule
  validation, reconciliation).

#### 2.6 The change log

`WorkChange`, one row per field written:

- `registerId`, `at`, `author`;
- `entity`, `code`, `field`, `before`, `after`;
- `source`: the app, the workbook, an import, a merge, or the MCP.

It is the history of every row, the source of the workbook's log sheet (§5.4), and the base of the alerts' audit.

#### 2.7 The workbook link and its snapshots

- **`WorkExcelLink`.** One per register at most:
  - `registerId`, `displayPath`;
  - `layoutVersion`, `lastFileHash`, `lastSnapshotId`;
  - `state`: aligned, file ahead, app ahead, diverged, unavailable, locked, or unreadable.

  The path itself is kept only as the shell gave it (§5.8).
- **`WorkSnapshot`** and **`WorkSnapshotRow`.** At each alignment, the input values of every row of the workbook,
  by sheet and code, with a fingerprint (SHA-256 of the canonical values). They are the base of the three-way
  comparison of §5.5 and live in the encrypted database, not in a hidden sheet of the file: a hidden sheet travels
  with the file and anyone can edit it.
- **`WorkFileVersion`.** The previous versions of the linked file, kept as blobs in the encrypted database: the last
  20, and one per day for 30 days.

### 3. Migrations

- **Only local migrations.** The tables do not exist online, so no Postgres migration is written. `npm run
  local:migration` (M1 §4) diffs the derived schema, which now includes the fragment, and writes the SQLite
  migration as for any other change. The app applies it at start-up after an encrypted backup, as M1 does.
- **CHECKs.** The local-only CHECK constraints go into `prisma/local/checks.sql`, in a section of their own. M1's
  twin test starts from the Postgres CHECKs, so it never meets these tables. M1's other test, which compares the
  CHECKs live in the local file with `checks.sql`, covers them as it covers the rest.
- **Seeds.** The first migration creates the fixed lists (event types, states, hearing modes) and nothing else: no
  court, no person, no rule.

### 4. The term engine

A pure module, `src/work/terms/`, with no database and no clock of its own: given an origin day, a rule, the
proceeding's suspension and the holidays, it returns the day, or a refusal that names what is missing. It is the
part of this design that, if wrong, makes a lawyer miss a term. So each step below comes from a norm read on
Normattiva on 28 November 2026 **[read]**, or is marked as a setting the lawyer validates.

#### 4.1 Forward terms (art. 155 c.p.c.)

- **Days.** The first day is not counted: «Nel computo dei termini a giorni o ad ore, si escludono il giorno o l'ora
  iniziali» (co. 1). Holidays inside the term count: «I giorni festivi si computano nel termine» (co. 3).
- **Months and years.** «Per il computo dei termini a mesi o ad anni, si osserva il calendario comune» (co. 2).
  - When the end month has no corresponding day (31 March plus one month), the engine takes the last day of that
    month. Art. 2963 c.c. says so for prescription («il termine si compie con l'ultimo giorno dello stesso mese»,
    co. 5). Art. 155 does not say it: it is a setting the lawyer validates.
- **The end on a holiday.** «Se il giorno di scadenza è festivo, la scadenza è prorogata di diritto al primo giorno
  seguente non festivo» (co. 4).
- **The end on a Saturday.** The extension «si applica altresì ai termini per il compimento degli atti processuali
  svolti fuori dell'udienza che scadono nella giornata del sabato» (co. 5). It applies to procedural acts outside a
  hearing, not to every term. For prescription art. 2963 c.c. extends only a holiday (co. 3). So `saturdayIsHoliday`
  is a property of the rule: true for a procedural act outside a hearing, false for a civil term. The lawyer
  validates it rule by rule.

#### 4.2 Backward terms

A term counted back from a hearing (a filing due so many days before it).

- The count goes back from the hearing's day, excluding that day, by the rule's quantity in days.
- **Backward terms in months are refused**: none is needed today, and refusing is safer than guessing.
- **The end on a holiday or a Saturday.** Art. 155 speaks only of extending forward. What happens to a backward term
  that ends on a holiday is not in its text: «anticipate to the previous working day» is a `holidayPolicy` the
  lawyer validates, with its source written in the rule's `reference`.

#### 4.3 Holidays

- The national holidays come from `italianHolidays.ts`. Today it serves the planner's «every working day», and its
  own comment says it «knows nothing of the summer suspension of procedural time limits or of the extension to the
  next working day (art. 155 c.p.c.)». This design adds both, in `src/work/terms/`, and reuses the holiday list.
- A court's own holiday applies only to events of that court's proceedings, and only if the firm entered it.

#### 4.4 The summer suspension (l. 7 ottobre 1969, n. 742)

- **The period.** «Il decorso dei termini processuali relativi alle giurisdizioni ordinarie ed a quelle
  amministrative è sospeso di diritto dal 1º al 31 agosto di ciascun anno, e riprende a decorrere dalla fine del
  periodo di sospensione. Ove il decorso abbia inizio durante il periodo di sospensione, l'inizio stesso è differito
  alla fine di detto periodo» (art. 1, co. 1).
- **The engine counts it by days, not by a fixed addition.** A forward term pauses on 1 August and resumes after 31
  August; a start inside August is deferred to its end. A backward term skips August going back. It holds for terms
  that cross more than one August.
  - Whether a backward term is suspended at all, and how, is a setting the lawyer validates.
  - For a term in months, how the months and the 31 days of August combine is also validated.
- **Exclusions.** «In materia civile, l'articolo 1 non si applica alle cause ed ai procedimenti indicati
  nell'articolo 92 dell'ordinamento giudiziario 30 gennaio 1941, n. 12, nonché alle controversie previste dagli
  articoli 429 e 459 del codice di procedura civile» (art. 3). Art. 92 ord. giud. lists, among others, «alimenti»,
  «procedimenti cautelari», «sfratto», «opposizione all'esecuzione», and the causes declared urgent.
  - The proceeding's `summerSuspension` decides: the lawyer sets it.
  - The app may suggest «no» for a type on that list, and never sets it alone.
- **When the proceeding does not say.** The engine computes the earlier of the two dates, with and without the
  suspension, and marks the result «suspension not stated: earlier date». An earlier date can only make a lawyer act
  early. A rule may exclude the suspension altogether (`summerSuspension` false), and then the question does not
  arise.

#### 4.5 Notifications by PEC (art. 147 c.p.c.)

For the recipient, a notification by PEC is perfected when the delivery receipt is generated; «Se quest'ultima è
generata tra le ore 21 e le ore 7 del mattino del giorno successivo, la notificazione si intende perfezionata per il
destinatario alle ore 7» (co. 3). An event that starts from a PEC notification received carries `receivedAtTime`.
If that time falls from 21:00, the engine starts the term from the next day's 07:00, that is from the next day, and
says so.

#### 4.6 Validation, recomputation and the cross-check

- **Unvalidated rules compute, and say so.** The event shows the computed date with «regola non validata», the
  alerts treat it as any other date, and the views mark it. Validating a rule writes `validatedAt`, `validatedBy`
  and a diary entry on every practice that has an event computed by it.
- **A rule changed after validation goes back to unvalidated**, and so do its events' marks.
- **Recomputation.** A change to an origin event, a rule, a proceeding's suspension or a holiday recomputes every
  event that depends on it, in the same transaction, and logs each changed date.
- **The workbook's own date as a cross-check.** A linked workbook computes its own date in its formulas. When the app
  reads a row, it compares the workbook's cached computed date with its own, and shows every difference as «Diversa
  dal calcolo» on both sides. On the test set (§10) the two must agree on every row before the engine is enabled for
  a firm's rules.
- **Postponement.** When a hearing is postponed:
  1. the old event becomes «Rinviata»;
  2. a new hearing is created;
  3. each open event computed from the old one moves to the new one if its rule has `followsPostponement`;
  4. the lawyer sees the list and can change the choice before confirming.

  This is the behaviour of the pane the owner uses today, held as a rule property rather than a code pattern.

### 5. The Excel engine

#### 5.1 The layout

- **What the app understands.** `src/work/excel/layout.ts` declares the sheets the app reads and writes (practices,
  proceedings, events, diary, rules, holidays, lists, log), each with its header row and its headers, under G-622's
  structure.
- **Columns are found by header text, never by letter**, so a firm can move or add columns.
- **Two kinds of columns.**
  - Input columns: the only ones the app may write.
  - Computed columns: read only for the cross-check.
- **A missing required header makes the link read-only** and lists the problem, as the owner's pane does today.

#### 5.2 Reading

- Only `.xlsx`. A `.xlsm`, `.xlsb` or `.xls` is refused with its reason. A file over 20 MB is refused.
- **The archive is opened with limits**: at most 2,000 entries and 200 MB uncompressed in total, against a «zip
  bomb».
- **The XML is parsed with document type definitions disabled.** «Disable document type definitions (DTDs) whenever
  possible» is OWASP's general guidance against external entities **[read]**. A part that declares a DTD is refused.
- **Values only.** No formula is ever evaluated. A computed column's cached value is read only for the cross-check.
- **Rows are matched by code.** A row without a code is shown as «senza codice» in the reconciliation and never
  guessed.

#### 5.3 Writing: the cells the app owns, nothing else

A library that loads a workbook into its own model and saves it again keeps only what it models: conditional
formats, validations, defined names or charts it does not know would be lost **[estimated]**. A firm's workbook
lives on its formulas and formats. So the app never rewrites the workbook. It edits it in place:

1. it opens the archive and edits only the XML of the sheets it writes, and in those only the cells of input
   columns, as inline strings, numbers or date serials;
2. it never writes a cell that holds a formula, and a test fails if a plan names one;
3. it sets the workbook to recalculate fully on open, so the computed columns follow;
4. it copies every other part of the archive byte for byte. A test round-trips a synthetic workbook built in the
   test and compares every part the app did not touch.

That Excel and LibreOffice open such a file, keep the inline strings and recompute on open is checked by hand on
both systems in the first task of stage 5 **[estimated]**.

New rows go into the first row whose input columns are all empty, never inserted, so the firm's formulas below
stay in place. A full sheet is refused with «the sheet is full: extend its formulas», as the pane does today.

#### 5.4 The log sheet

- **What it holds.** Each write appends rows to the log sheet («Registro»): date and time, author, sheet, code,
  field, value before, value after, source.
- **The file carries its history.** Whoever receives the file receives that history. The app says so when the link
  is made, and the export (§5.10) can leave it out.

#### 5.5 Detecting divergence

- **The fast path.** The file's SHA-256 against `lastFileHash`; equal means aligned.
- **The real check.** Excel saving a file without changing any input value still changes its bytes. So when the hash
  differs, the app reads the input values of every row and compares, by code:
  - against the last snapshot: what changed in the file;
  - and against the change log since that snapshot: what changed in the app.

  Then each row is one of: unchanged; changed in the file; changed in the app; changed on both sides, the same way;
  changed on both sides, differently; new in the file; new in the app; gone from the file.
- **When it checks:**
  - at start-up;
  - when the window gains focus;
  - before every write to the file;
  - every five minutes;
  - when the file watcher reports a change.

  The watcher is a hint, not the truth. Watcher libraries document that editors save by writing a new file and
  replacing the old one, and that renames and network or synced folders may report nothing **[read]**. So the app
  watches the file's folder, not the file, and never relies on an event alone.

#### 5.6 States, «Riallinea con Excel» and the divergent branch

This is the behaviour the owner asked for (G-621, the second part of his proposal of 27 November), made precise:

1. **Aligned.** Each write in the app goes to the main register, then to the file (§5.3), then a new snapshot.
2. **The file changed outside the app.**
   - The app reads the file into a register of kind `excel`, read-only, named with the date and time.
   - The link goes to «file ahead».
   - The app shows the warning with the button «Riallinea con Excel».
   - The main register stays as it was at the last alignment: it is the common base.
3. **«Riallinea con Excel»** shows the differences row by row against the base, and for each the lawyer chooses:
   keep the app, keep the file, or keep both. Keeping both gives one of the two rows a new code; the lawyer picks
   which.
   - The result becomes the main register and is written to the file.
   - The `excel` register is marked merged and kept.
4. **Writing in the app without reconciling.** The first write after the warning forks the main register into a
   `branch`, with a name, the time and the base snapshot, shown in the app's header. The write and all later ones
   go to the branch.
   - The app does not write to the file while a branch is open.
   - Reconciling is then a three-way merge between the branch and the `excel` register over the common base, with
     the same row-by-row choices.
5. **Codes on both sides.** Both sides number new rows from the same last number, so E-0042 can be born twice. Two
   different rows with one code are always a conflict, never a match.
6. **Nothing that deletes is automatic.** A row gone from the file is shown, never deleted on its own. A
   reconciliation that would remove more than five rows asks again, with the count.

#### 5.7 The file open in Excel, and the atomic write

- **The file may be open in Excel.** On Windows Excel holds the file open while it is in use, and on macOS it saves
  by replacing the file **[estimated: measured in the first task, on both systems]**. The app treats a file it
  cannot open for writing, or a lock file of Excel next to it, as «locked».
  - It keeps the writes queued in the change log.
  - It writes them when the file is free again, after the divergence check of §5.5.
- **The write.** Always to a temporary file in the same folder, flushed to disk, then renamed over the original. The
  version it replaces is kept first (§2.7).
- **Stale data.** If the file changed between the check and the rename, the write is abandoned and the check runs
  again.

#### 5.8 Choosing the file: the shell's dialog, never the page

- **The page asks.** It calls `POST /api/work/excel/pick` or `/export`.
- **The shell's native dialog chooses.** The server writes a request on its private channel to the shell, the
  stdout of M1 §6. The shell opens its native dialog and answers on the sidecar's stdin with the path, or with a
  cancel.
- **The server confines itself to that path.** It records the path and the link, and later requests name the link,
  never a path. It writes only that file and its temporary sibling.
- **A path in a request body is refused**, and a test proves it.

#### 5.9 Synced folders

- **Online-only files.** A file kept «online-only» by Dropbox takes no space and shows as zero bytes on recent macOS
  **[read]**. iCloud Drive can move documents off the Mac when space is needed **[read]**. The app never reads a
  zero-byte or missing file as an empty workbook, which would look as if every row had been deleted. It sets the
  link to «unavailable» and says to make the file available offline.
- **Conflicted copies.** Dropbox creates one when two people edit the same file, or when a file «is left open on
  another user's computer» **[read]**. The app notices a file next to the linked one with «conflicted copy» in its
  name and shows it as a divergence to reconcile, never ignores it.
- **Warning before linking.** A path inside a folder that a sync client manages gets the warning of the risks
  section: the data leave the computer.

#### 5.10 Export and import

- **Export.** A new workbook in LexCraft's own layout, which is the structure of §5.1:
  - values only, with no formulas, the computed dates written as values and marked as computed by LexCraft;
  - the log sheet only if the lawyer asks.

  Text that a spreadsheet could read as a formula is written as text. In an `.xlsx` a cell written as a string is
  not a formula. OWASP's list for CSV is `=`, `+`, `-`, `@`, tab, carriage return, line feed, and their full-width
  forms **[read]**: the app also prefixes those in any CSV it writes.
- **Import.** From a workbook that follows the layout:
  1. a preview lists the rows that would be created, updated, in conflict or invalid;
  2. the lawyer confirms;
  3. the import is one transaction.

  The checks are the pane's, held in the model:
  - an event names a proceeding that exists;
  - a computed event has an origin and a rule and no date written by hand;
  - the origin carries a date written by hand;
  - the rule exists.

  An import never validates a rule. A rule marked validated in a file arrives unvalidated, and the reconciliation
  shows it.

### 6. Alerts (G-563)

#### 6.1 What raises one

For each open event, that is not in a closing state and not in a closed practice:

- **its effective date is past:**
  - for a hearing, «udienza senza esito»;
  - otherwise «scaduto»;
- **a hearing held with no outcome written;**
- **no date at all** («senza data»);
- **its effective date falls within its notice days** (7 if none):
  - the day of the effective date;
  - the recheck date for a check that has one;
- **a telematic filing:**
  - marked filed and not accepted after five working days;
  - accepted, with receipts not archived after three;
- **its date was computed by an unvalidated rule**, or the suspension was not stated: shown with the alert, never as
  an alert alone.

Also: a register diverged from its workbook for more than a day; a link «unavailable» or «locked» for more than a
day.

#### 6.2 Across every version

- **Where it reads.** The alerts read the main register, every active branch, and every `excel` register not yet
  merged. Each alert names the version it comes from.
- **No double alerts.** The same event, by code, with the same effective date and state in two versions, raises one
  alert that names both.
- **A deadline that exists only in the workbook alerts as much as one in the app.**

#### 6.3 Delivery

- **The local server computes them.** `GET /api/work/alerts` serves them to the page. A job in the sidecar checks
  every minute and at each change, and tells the shell over its private channel when a new alert is due. The shell
  shows the system notification.
- **The app closed.** Tauri's notification plugin shows desktop notifications at once and schedules them only on
  mobile **[read]**: no notification can be left with the system to fire later. So:
  - with the app closed, nothing fires;
  - the lawyer can turn on «Avvisi anche ad app chiusa». The app then starts at login, through the autostart plugin
    **[read]**, with no window, and the sidecar keeps checking;
  - at every start the app first shows the alerts it could not show while it was closed.
- **The text of a notification names no client by default**: «2 scadenze oggi, 1 udienza domani». Details open in
  the app. A setting shows the codes, never the names.
- **Nothing leaves the computer.** No e-mail, no push, no server. The daily digest, at an hour the lawyer sets, is a
  notification and a view.
- **Snoozing.** An alert can be snoozed to a later time on the same day, never past the deadline itself, and never
  for a peremptory term on its last day.

### 7. The API for the web

#### 7.1 Where it answers

- Mounted only in local mode, under `/api/work`. Online the routes do not exist and answer 404.
- **How the web knows it is in the app.** `GET /api/work/status` answers 200 in the app, with the active register,
  the open branches, the link's state and the count of alerts, and 404 online.
- **The rules of the local server stay as they are.** M1's port checks, the session cookie and the local profile
  apply, and deletions go to the trash. The online caps, which are built for many users, are set for one lawyer.

#### 7.2 The routes

| Area | Routes |
|---|---|
| Status | `GET /status` |
| Registers | `GET /registers`; `POST /registers/:id/merge` (preview, then apply); `POST /registers/:id/archive` |
| Practices | `GET /practices` (filters: state, person, area, text); `POST /practices` (the next code proposed); `GET /practices/:code`; `PATCH /practices/:code`; `DELETE /practices/:code` (to the trash) |
| Proceedings | the same, under `/proceedings` |
| Events | the same, under `/events`; actions:<br>• `POST /events/:code/done` (filed, accepted, done or not due, with the date)<br>• `/held` (outcome, next hearing)<br>• `/postpone` (new date and time, the events that follow, §4.6)<br>• `/recheck` (new date, or close)<br>• `/payment` (date, amount, full or partial) |
| Views | `GET /views/week`, `/views/month`, `/views/acts`, `/views/alarms`, `/views/practice/:code`, `/views/person/:person`, `/views/area/:area` |
| Rules | `GET /rules`; `POST /rules`; `PATCH /rules/:code`; `POST /rules/:code/validate`; `GET /rules/:code/preview` (the dates it would give for an origin day) |
| Holidays, lists | `GET`/`PUT /holidays`; `GET`/`PUT /lists/:list` |
| Diary | `GET /diary?practice=`; `POST /diary` |
| Excel | `POST /excel/pick` (through the shell, §5.8); `GET /excel`; `POST /excel/check`; `GET /excel/reconcile`; `POST /excel/reconcile` (the choices); `POST /excel/import/preview`; `POST /excel/import/:previewId/apply`; `POST /excel/export`; `DELETE /excel` (unlink, nothing deleted) |
| Alerts | `GET /alerts`; `POST /alerts/:id/snooze`; `GET /alerts/missed` |

- **Every write answers with the new version.** A write naming an old version answers 409.
- **While the register is diverged**, a write answers with the branch it went to, so the page can show it.

#### 7.3 The local MCP server (M6)

- **Not in the delegated routes by default.** The routes of this design are not in the table of delegated routes
  of the local MCP server.
- **The lawyer's switch.** He can turn on «Claude può leggere lo scadenzario» per client, in «Collega un'app AI»,
  read-only. The switch says that what Claude reads goes to the model's provider.
- **Writes through the MCP** come later, with the confirmation and trash rules of today's MCP tools.

### 8. Practices as folders: the default this design assumes

The owner asked on 23 November for practices kept «like an Obsidian vault»: a folder per practice, on his own
computers. One question is still open with him: whether notes edited outside the app are read back. This design
assumes a default and lists the question (W2).

- **The constraints.**
  - G-613 encrypts the database. A folder of readable files is not encrypted: Obsidian itself states «Obsidian
    doesn't encrypt your local vault» **[read]**.
  - Rule 23 of `CLAUDE.md` pins highlights and anchored notes to the exact text of `article_text`. A text edited in a
    file and read back would delete them silently.
  - Obsidian keeps its block references inside the note itself (`^id`) and refreshes when files change outside it
    **[read]**: links that live in the files break when another program edits them.
- **The options.**
  - (a) Notes are written in the folder and read back. Texts of norms and decisions are never read back. Anchors stay
    in the database, never in the files.
  - (b) **The folder is a read-only export.** When the lawyer turns it on, the app writes one folder per practice:
    Markdown notes, the texts of its sources, a card with its proceedings and events. It rewrites the folder at each
    change and never reads it back.
  - (c) The folder is the source of truth and the database an index.
- **Recommendation: (b) now, (a) later.** (b) keeps the encrypted database as the only truth, cannot touch an anchor,
  and gives the lawyer readable files when he wants them. (a) can come later through the same divergence engine as
  the workbook (§5.5), applied to notes only.
- **Either way the folder is plain text**, with the warning of §5.9.

### 9. Stages

Each stage is one or more pull requests, stacked on M1 (#764), with the tests of §10. The web owner confirmed this
order on 28 November. The porting line builds both the backend and the app's screens, and the web owner reviews
them, as for M1.

1. Tables with every field's class (§11.1), codes, rules, holidays, lists, diary, the term engine, the views, the
   API without Excel, and the marks of personal fields in the API.
2. Alerts, with the shell's channel for notifications, and the login item as an option.
3. Export.
4. Import with its preview.
5. The linked workbook both ways: log sheet, divergence, reconciliation, branches.

**After the first version:**

- the pseudonymised web mirror (§11.2–11.5), after the DPIA and the legal check (W16);
- fees and invoices («Preventivi e parcelle»): records only, no payment (D-304, W9);
- insolvency claims;
- the cloud connectors;
- synchronisation (W10);
- the folder of §8 (a);
- the MCP switch of §7.3.

### 10. Tests

- **Schema.**
  - The online schema names no `Work*` model; Postgres has no `work_` table.
  - The derivation merges the fragment and its back-relations, and refuses an unknown one.
  - The local-only CHECKs are live.
- **The term engine.** One case per sentence of each norm quoted in §4, with real calendars:
  - a term ending on a Sunday, on Easter Monday, on 4 October 2026;
  - on a Saturday, with `saturdayIsHoliday` true and false;
  - a start on 15 August;
  - a term from 20 July across August;
  - a term crossing two Augusts;
  - a backward term across August, and one ending on a holiday;
  - 31 March plus one month;
  - a backward term in months, refused;
  - a PEC receipt at 21:30 and at 06:59;
  - a proceeding with the suspension not stated, giving the earlier date and its mark;
  - a computed origin, refused.
- **Validation.** An unvalidated rule computes and is marked. Validating writes the diary on each practice. A changed
  rule goes back to unvalidated. A recomputation logs each change.
- **The workbook.** On synthetic workbooks built in the test, never a firm's file:
  - a round trip that changes one cell leaves every other part byte for byte;
  - no plan writes a formula cell;
  - a full sheet is refused;
  - a missing header makes the link read-only;
  - `.xlsm` refused; a zip bomb refused; a DTD refused;
  - a formula-like text written as text, and prefixed in CSV;
  - a zero-byte file, unavailable and not empty;
  - a «conflicted copy» found;
  - a locked file queues, then writes;
  - a change between check and rename abandons the write;
  - a path in a request body refused.
- **Divergence.** Every cell of §5.5's matrix:
  - a write during divergence forks a branch;
  - a merge with each choice;
  - the same new code on both sides, a conflict;
  - a deletion of six rows asks again.
- **Alerts.**
  - Every condition of §6.1.
  - An event only in the `excel` register alerts.
  - The same event in two versions alerts once, naming both.
  - A snooze never passes the deadline.
  - Missed alerts are shown at start.
  - The notification text names no client.
- **Data classes.**
  - Every scalar field of the Work models has a known class.
  - `GET /api/work/classes` matches the schema.
  - When the mirror is built: the canary test of §11.3; a lapsed confirmation keeps its field home; a publish whose
    preview changed answers 409; the online schema refuses an unknown field and a `personal` one.
- **Routes.**
  - Each route on the encrypted file, in the CI job «local» of M1, on macOS and Windows.
  - `/api/work` answers 404 online.
  - Nothing outside `src/local/` and `src/work/` imports `src/work/`.

### 11. Data classes and the pseudonymised web mirror

The owner's principle of 28 November makes the web the place where practices live pseudonymised, and asks that the
places of a practice holding personal data be told apart from those that hold none, «così che il web possa essere un
mirror sicuro». This section designs that line. It builds on G-621: the clear data stay in the app; only what has
passed the line below may reach the web.

#### 11.1 Every field has a class

**The classes.** They describe what a field holds, not the legal status of the whole: a pseudonymised practice is
still personal data (§11.6).

| Class | Meaning | May reach the web |
|---|---|---|
| `personal` | names or reaches a person directly: client, counterparty, their lawyer and PEC, the judge, the firm's people, the docket and decision numbers, which identify a case at the court's registry | never |
| `indirect` | identifies only combined with other facts: the court and its section, every date and time, amounts and values, the insolvency flag | never by default; only generalised, if W12 allows (§11.4) |
| `pseudonymisable` | free text: titles, subjects, outcomes, notes, diary entries, a dossier's name and description | only after pseudonymisation on the computer and the lawyer's confirmation, field by field (§11.2) |
| `non-personal` | says nothing about a person on its own: the type, rite and degree of a proceeding, states, the area, the rule's code, a flag such as «peremptory», the references to norms and decisions | yes |

The request of 28 November named three classes; `indirect` is a fourth, and W11 asks whether to keep it.

- **Without `indirect`**, the court, the dates and the amounts must be put in `personal`, and they never leave, or in
  `non-personal`, and they leave in clear.
- **The fourth class names the real risk.** These fields carry nothing alone, but in a lawyer's practice they
  identify together.

**Where the class is written.**

- **Beside the field, in the schema**, as a documentation comment Prisma keeps with it:

  ```
  client        String?  /// class: personal
  type          String   /// class: non-personal
  notes         String?  /// class: pseudonymisable
  ```

- **Which models.** Every model of `prisma/local/work.prisma`, and the Work models of `prisma/schema.prisma` that the
  app holds and the mirror could carry: `Dossier`, `DossierItem`, the notes and highlights, `Task`. A lawyer names a
  dossier after a client today; the class says so.
- **A test fails** when a scalar field of those models has no class, or an unknown one. Relation fields carry none.
  The list of Work models is the test's own; a new model of the local fragment is in it by default.
- **Some fields take the class of another.** `WorkChange.before` and `.after` take the class of the field they log,
  and are `personal` as a whole, since they are never mirrored. A list item takes the class of its list: the persons
  list is personal, the courts list is not.
- **The API serves the classes.** `GET /api/work/classes` returns them, so the web can mark the fields that hold
  personal data (§11.5).

The first classification of every field is a table in the pull request of stage 1, reviewed by the owner.

#### 11.2 Free text: personal until pseudonymised and confirmed

A free-text field counts as personal. It reaches the web only through three steps on the computer:

1. **The practice's own names first.** The structured personal fields of the practice are an exact list of the
   strings to replace: the client, the counterparty, their lawyer, the judge, the firm's people. The app replaces each
   occurrence with its pseudonym from the map (§11.3), consistently across every text of the practice. This step needs
   no model.
2. **Pseudocraft for the rest.** Pseudocraft (LexCraft-IT/pseudocraft), the web owner's local pseudonymiser, finds the
   names the practice does not list, and other identifiers (addresses, tax codes, IBANs, phone numbers), with its rules
   and its local models. It runs on the computer and makes no network call at run time.
   - **How LexCraft uses it**, as the web owner answered on 28 November:
     - its core, the pipeline and the subjects' register, as a library;
     - its code as the base of the desktop app's own pseudonymisation primitive, without its review window;
     - the subjects held in LexCraft's encrypted table (§11.3) and passed in at each call;
     - the confirmation screen is the app's.
   - **No pseudonymisation on LexCraft's servers.** The web gets the primitive only later; there is no compute to host
     it today.
   - **Its README states macOS on Apple Silicon only.** The app ships for Windows x64 too (G-620), so the primitive
     must run there: §11.7 makes it a requirement and gives its cost. **Until it does, free text does not leave a
     Windows computer at all**: only `non-personal` fields mirror there.
3. **The lawyer confirms**, field by field, the original beside the pseudonymised text, with every replacement
   highlighted and editable.
   - The confirmation records the pseudonymised text, a fingerprint of the original, pseudocraft's version and the
     time.
   - If the original changes, the confirmation lapses, and the field stays home until it is confirmed again.

**Facts are not names.** Pseudonymisation replaces who; it leaves what happened. A text about a client's illness, or
a conviction, stays data about health or crimes (arts. 9 and 10 GDPR) after its names are replaced. The confirmation
screen asks the lawyer to keep such facts out of a mirrored text, and W13 asks whether such texts should never leave.

#### 11.3 The pseudonym map never leaves the computer

`WorkPseudonym`, local-only, `personal` as a whole: the original string, the kind (client, counterparty, lawyer,
judge, person, other), the practice, and its pseudonym («Cliente», «Controparte A», «Avv. B»).

- **It never leaves the computer.** It is in the encrypted database and in the encrypted backups, so a restore keeps
  the mirror readable. It is never in an export, never in the mirror, and never served by the local MCP server.
- **A test sends a practice whose personal fields carry canary strings** through the mirror builder, and fails if a
  canary appears in the payload.
- **The mirror's own identifier.** A mirrored practice is named online by a random identifier, not by its code
  P-001. The code is sequential, and the firm's workbook links it to the client. Whether the web shows the code
  beside it is W15.

#### 11.4 Generalising indirect fields

If W12 allows it, an indirect field may leave generalised, never as it is:

- a court becomes its kind and level («Tribunale», first degree);
- a date becomes the number of days from another event of the same practice, or a month;
- an amount becomes a range.

The recommendation (W12) is that nothing indirect leaves in the first mirror.

#### 11.5 What the lawyer sees before anything leaves

- **Each practice is mirrored only if the lawyer turns it on**, practice by practice. It is off by default.
- **The preview.** `GET /api/work/mirror/:code/preview` returns the exact payload that would be sent, and the page
  shows it as the web would, beside what the web already holds. The fields that stay home are listed with their
  class.
- **The publish sends exactly the preview.** `POST /api/work/mirror/:code/publish` carries the preview's fingerprint.
  If anything changed since, it answers 409 and asks for a new preview.
- **The mirror runs one way**, from the app to the web.
  - Text edited in the web does not come back.
  - A `non-personal` addition, such as a norm or a decision added to the dossier, may come back (W15).
- **How it travels.** The web owner answered on 28 November that the web and the app synchronise over an encrypted
  channel while the lawyer's computer is on, «simil remote control»: the relay forwards packets it cannot read. That
  channel is the remote access the owners are designing separately, and this section waits for it.
  - What the web may keep on LexCraft's servers is W18. The recommendation is that the pseudonymised part of a work
    dossier is shown live from the computer and never stored online. The web's own research (norms, decisions,
    notes on the law) stays stored online as today.
  - «Nel web devono stare il meno possibile i dati dei clienti» (the web owner, 28 November).
- **Withdrawing.** The lawyer can withdraw a practice from the web at any time; the online copy is deleted. What the
  host's own backups keep, and for how long, is part of the legal check.
- **The server refuses what it does not expect.** The online server accepts a mirror only through a schema that
  lists the allowed fields. An unknown field, or one whose class is not allowed, is refused, so a bug in the app
  cannot widen the mirror.
- **The mirror's online models.** They are named `Mirror*`, hold only allowed fields, and are designed with the
  DPIA. The test of §1 still keeps every `Work*` model out of the online schema.
- **The marks in the interface.** In the app every field of class `personal` or `indirect` carries a mark, and so does
  every `pseudonymisable` field not yet confirmed. In the web a mirrored practice is labelled «pseudonimizzata», never
  «anonima».

#### 11.6 The legal risk, plainly

- **Pseudonymised data are personal data.** The GDPR defines pseudonymisation as processing such that the data «non
  possano più essere attribuiti a un interessato specifico senza l'utilizzo di informazioni aggiuntive», kept apart
  (art. 4(5)) **[read]**. Recital 26: «I dati personali sottoposti a pseudonimizzazione, i quali potrebbero essere
  attribuiti a una persona fisica mediante l'utilizzo di ulteriori informazioni, dovrebbero essere considerati
  informazioni su una persona fisica identificabile» **[read]**.
  - The test is the means «di cui il titolare del trattamento o un terzo può ragionevolmente avvalersi», «tenendo
    conto sia delle tecnologie disponibili al momento del trattamento, sia degli sviluppi tecnologici» **[read]**.
  - Only data that do not, or no longer, allow identification are anonymous, and outside the regulation **[read]**.
- **In legal practice, context re-identifies.** A court, a few dates and the facts of a case can be matched with a
  published decision, a court's calendar, a news report or the other side's knowledge.
  - The removal of names does not reach this risk. Leaving the indirect fields at home reduces it (§11.4); the
    lawyer's confirmation of each text reduces it further. Neither removes it.
- **So the mirror is personal data, held by its host.**
  - The firm remains the controller.
  - Whoever hosts the mirror, the association or a self-hosted server, processes personal data for the firm. That
    asks for the contract of art. 28 GDPR, and partly gives back what G-621 avoided.
  - Art. 35 GDPR asks for a data protection impact assessment «prima di procedere al trattamento» when a processing
    «può presentare un rischio elevato» **[read]**. It names in particular the large-scale processing of special
    categories (art. 9) or of data on convictions and offences (art. 10) **[read]**, which free text in legal practice
    can hold.
- **Professional secrecy** binds the facts a client confides, not only the names. Whether a pseudonymised copy on a
  third party's server is compatible with it is part of the legal check.
- **Before the mirror is built**: a DPIA and a legal check (W16). Until both are done, the classes, the marks and the
  preview can be built, and nothing is sent.

#### 11.7 The pseudonymisation primitive on macOS and Windows

The app ships for Apple Silicon and Windows x64 from its first version (G-620). A lawyer on Windows must be able to
mirror free text as a lawyer on a Mac can, so **the primitive must run on both**. That is a requirement of this
design, set before the mirror is enabled on either platform.

**What pseudocraft is today** **[read]**, from its project file and installation guide:

- **The stack.** A Python 3.12 core with `torch`, `transformers`, `onnxruntime` and `llama-cpp-python`, built with
  Metal on macOS. PyInstaller is in its build group.
- **Hardware.** At least 8 GB of memory. A 4B «judge» model on 8 GB; a 9B one is offered only from 16 GB.
- **Disk.** About 1 GB for the application and about 5 GB for the models (10.5 GB with the 9B).
- **Models.** Downloaded at first launch, each checked against its SHA-256. The judge uses the GPU through Metal.
- **Platform.** macOS on Apple Silicon only, by its own statement. No macOS-only library appears in its
  dependencies, but it has not been tried on Windows.

**Requirements:**

1. **The same pipeline on both platforms.** On a corpus of synthetic texts, the rules and the recognition models
   give the same replacements on macOS and on Windows. The judge runs with a fixed seed and no sampling. Where it
   still differs, the field goes to the lawyer's confirmation as every field does.
2. **A separate process, on demand.** The primitive runs as a second sidecar, started when the lawyer opens the
   confirmation screen and stopped after a few idle minutes.
   - It speaks JSON over stdin and stdout with the local server: no port.
   - It is outside the app's memory threshold (G-618), which holds for the app without it. Before starting, the app
     checks the free memory and says so if it is short.
3. **Models only on request.** The models are downloaded only when the lawyer turns the mirror on, from a source fixed
   in the app, each checked against its SHA-256. No other network call.
4. **An optional component.** The primitive is not in the installer, which stays near M1's estimate of about 50 MB.
   It installs on first use and can be removed with its models.
5. **Signed like the app.** Every native library inside is signed: Windows with the OV certificate (G-619), macOS
   when the Developer ID arrives.
6. **Below 8 GB, no judge.** The rules and the recognition models still run, the confirmation screen asks for a closer
   look, and nothing changes in what the lawyer must confirm.
7. **Licences.** Pseudocraft is under MPL-2.0, as LexCraft is, and the notices at the head of its files are kept (MPL
   §3.4) **[read]**. It already checks its dependencies' licences with a script **[read]**. The licences of the models
   go into the app's notices.

**What it costs**, in working days of one line **[estimated]**:

| Road | What | Days | Limits |
|---|---|---|---|
| (P1) Pseudocraft's core as it is, packaged for both platforms | a trial on the real Windows PC (G-620): the core built with PyInstaller, pseudocraft's end-to-end tests, time per page and memory with the 4B judge on the CPU | 1–2 | — |
| | the sidecar's protocol and its client in the local server | 2–3 | — |
| | packaging for both platforms as an optional component, signing the Python native libraries, builds on the macOS and Windows runners. The tests with models run on the real PC, not in CI | 4–6 | — |
| | **total** | **7–11** | the heaviest component: about 1 GB plus 5 GB of models; on Windows the judge runs on the CPU unless a GPU backend works there, to be measured |
| (P2) A slimmer primitive | the rules and the recognition models through ONNX runtime, without `torch`, the judge optional | 8–12 | it changes pseudocraft's pipeline: it needs the web owner's yes and his end-to-end tests as the measure |
| (P3) macOS first | free text stays home on Windows until (P1) or (P2) | 0 now | a Windows lawyer mirrors only `non-personal` fields |

**Recommendation:** start with (P1)'s trial. Keep (P1) if the trial meets the thresholds of W19 on the reference
PC; otherwise (P2). Until then, (P3) holds by itself, since free text needs the primitive.

## For the web owner

Nothing here changes lexcraft-web until its owner decides; the brief to him is in the owners' private notes. What
the backend gives the web is §7. Three things the web should know now:

- **Nothing personal of this design appears online** (G-621). The web shows Work in three levels only when `GET
  /api/work/status` answers. The only way a practice reaches the web is the pseudonymised mirror of §11, after the
  lawyer's preview and confirmation, and not before the DPIA.
- **The web's own practices and tasks** can be written with a client's name today. The web owner answered on 28
  November with a fourth road:
  - work, study and public dossiers in both the web and the app (`Dossier.kind` has `lavoro` and `studio` today; the
    public dossier is the published copy);
  - in the web, Work serves research for one's work, kept apart from personal study (Learn);
  - the web and the app synchronise over the encrypted channel while the computer is on (§11.5);
  - as little client data in the web as possible.

  Until the mirror exists, the free-text fields of a web work dossier are `pseudonymisable` and can carry the mark of
  §11.5. In the app a practice hangs on a work dossier (§1); whether the app's new section replaces «Pratiche» is
  still open.
- **Who builds the app's screens**: the porting line, with the web owner's review (his answer of 28 November).
- **The notifications are the shell's**, not the page's, and the native dialogs too (§5.8).

## Decisions for the owners

**W1 · The firm's rules and layout in public code.** G-622 makes the template's structure LexCraft's. Its rules and
its formulas come from a firm.
- (a) The structure and the rules may be reused: the rules ship as LexCraft's, unvalidated.
- (b) The structure only: LexCraft writes its own rules from the norms, and each firm imports its own.
- (c) Neither in public code.
- **No recommendation: the answer is the owner's, with the firm.** Until then this design holds to (b) and ships no
  rule.

**W2 · Practices as folders** (§8). Recommendation: (b) a read-only export now, (a) later.

**W3 · Where the local-only tables live** (§1). Recommendation: (B), the local fragment.

**W4 · Where the row fingerprints live.**
- (a) In the encrypted database.
- (b) In a hidden sheet of the workbook.
- **Recommendation: (a).** A hidden sheet travels with the file, and anyone can edit it.

**W5 · The branch** (§5.6). The main register stays the common base, the workbook's content becomes a read-only
`excel` register, and the first write after a warning forks a branch. Recommendation: as written.

**W6 · Unvalidated rules** (§4.6).
- (a) They compute and alert, marked «regola non validata».
- (b) They compute nothing until validated.
- **Recommendation: (a).** Under (b) a register imported on day one would show no deadline at all.

**W7 · Where the linked workbook may sit** (§5.9).
- (a) Anywhere, with a warning inside a synced folder.
- (b) Never inside a synced folder.
- (c) Anywhere, with no warning.
- **Recommendation: (a).** A firm that shares its register through Dropbox today must be able to keep doing it,
  knowingly.

**W8 · Alerts with the app closed** (§6.3).
- (a) An option, off by default: the app starts at login with no window.
- (b) On by default.
- (c) Never.
- **Recommendation: (a)**, with the notifications' text naming no client by default.

**W9 · The first version's order** (§9). Fees and invoices only as records, after the first version: D-304's
reserve says «in Work nessuna schermata dedicata ai pagamenti». Recommendation: as written. The web owner agreed on 28
November, to the order and to a sheet that only records fees, invoices and payments.

**W10 · Does the register synchronise at all**, once synchronisation exists (D-163)? On the model the web owner
answered on 28 November: synchronisation is free when the firm hosts it, and a paid plan on the association's servers.
Whether the register takes part is still this question.
- (a) Never: it stays on one computer, with encrypted backups (M4).
- (b) Only end to end encrypted, per register, off by default.
- (c) Like any other data.
- **Recommendation: (b).** It has three costs:
  - the keys live only on the lawyer's devices: lose them and the 24-word recovery code (G-617), and the data are
    gone;
  - the server cannot search;
  - the server still sees sizes and times.

  Hosting it at the association makes the association a provider the firm must contract with (art. 28 GDPR), even
  if it holds only ciphertext: a point for the owners' legal check.

**W11 · How many data classes** (§11.1).
- (a) Three: personal, pseudonymisable, non-personal. The court, the dates and the amounts go into `personal`.
- (b) Four, with `indirect` for what identifies only in combination: the court, the dates, the amounts.
- **Recommendation: (b).** In legal practice context is the risk, and a class that names it keeps it visible in the
  schema, in the interface and in every review. Under (a) the same fields stay home anyway, but nothing says why.

**W12 · Indirect fields in the mirror** (§11.4).
- (a) Never.
- (b) Only generalised: a court's kind, relative days, ranges.
- (c) In clear, with the lawyer's confirmation.
- **Recommendation: (a) in the first mirror**, (b) only if the DPIA allows it. (c) brings back the context that
  re-identifies.

**W13 · Free text about health or crimes** (§11.2).
- (a) It may leave once pseudonymised and confirmed, with the warning on the confirmation screen.
- (b) A text the lawyer marks as holding such facts never leaves.
- (c) No free text leaves in the first mirror at all.
- **Recommendation: (b)**, unless the DPIA says (c).

**W14 · Pseudocraft as the pseudonymiser** (§11.2). **Answered by the web owner on 28 November:**
- its core as a library, and its code as the base of the desktop primitive;
- the subjects in LexCraft's encrypted table, passed in at each call;
- the web only later.

What remains is the Windows requirement, W19.

**W15 · The mirror's shape** (§11.3, §11.5).
- One way, app to web. A `non-personal` addition made in the web, such as a norm or a decision added to the
  dossier, may come back.
- A random identifier online. The code P-001 is not shown in the web unless the lawyer asks.
- **Recommendation: as written.**

**W16 · A DPIA and a legal check before the mirror** (§11.6).
- **What to settle:**
  - who is controller and who processor;
  - the contract of art. 28;
  - professional secrecy;
  - the host's backups and their retention;
  - the categories of arts. 9 and 10;
  - the words the app and the site may use. «Pseudonimizzata», never «anonima».
- **Recommendation:** classes, marks and preview are built now; nothing is sent before both are done.

**W17 · Events and tasks.** Open: the web owner will discuss it with the owner. His leaning: «evento genera compiti».
- **(a) The event generates the tasks.** In the app an event creates its preparation tasks.
  - The task's due date is the event's effective date, read-only, and follows a postponement.
  - Its planned date is the lawyer's.
  - The link lives in a local-only table (`WorkEventTask`), so the online `Task` model does not change.
  - In the web, tasks stay as they are, without events.
- **(b) Tasks and events stay apart**, with at most a reference from a task to an event.
- **Recommendation: (a)**, as the web owner leans. The link stays local, and a task never moves its own due date: it
  follows the event's.

**W18 · What the web keeps of a work dossier** (§11.5).
- (a) The pseudonymised part is shown live from the computer over the encrypted channel, and never stored on
  LexCraft's servers; the web's own research is stored as today.
- (b) A pseudonymised copy is stored online and refreshed when the computer is on.
- **Recommendation: (a).** It matches «il meno possibile» and the web owner's channel. It leaves the relay holding only
  ciphertext, which narrows the processing W16 has to assess. The cost: the practice is visible in the web only while
  the computer is on.

**W19 · The pseudonymisation primitive on Windows** (§11.7). The requirement is set; the road and the thresholds are
not.
- The thresholds (P1) must meet on the reference Windows PC: a proposal is one page of text in under 30 seconds and
  the primitive under 6 GB of memory with the 4B judge.
- The road: (P1), (P2) or (P3), with the costs of §11.7.
- **Recommendation:** (P1)'s trial first, with those thresholds; (P2) only if it fails.

## Answers of 28 November

The web owner answered the questions of his brief on 28 November. Where they change this design, the section names
them:

| Question | Answer | Where |
|---|---|---|
| The web's practices and tasks | a fourth road: work, study and public dossiers in web and app; Work in the web for work research, apart from Learn; sync over the encrypted channel with the computer on; as little client data in the web as possible | § «For the web owner», §11.5, W18 |
| The words; the app's section | «Dossier di lavoro» in both; whether the app's section replaces «Pratiche» is open | § «For the web owner» |
| Events and tasks | open, to discuss with the owner; leaning «evento genera compiti» | W17 |
| Codes | the template's format: P-001, P-001-A, E-0001 | §2 |
| The order of stages | the spec's | §9 |
| Who builds the app's screens | the porting line; the web owner reviews | §9, § «For the web owner» |
| Fees and invoices and D-304 | records only, no payment: it respects D-304 | W9 |
| Synchronisation | free when the firm hosts it; a paid plan on the association's servers (D-163) | W10 |
| Pseudocraft | its core as a library, the subjects in LexCraft's table, the base of the desktop primitive; the web later | §11.2, §11.7, W14 |

## Not in this change

- Any code: this is the design, for the owner's yes.
- Any change to lexcraft-web or lexcraft-mcp.
- The template, its rows, its rules or its formulas.

## Sources

**Norms, read on 28 November 2026** on Normattiva through the VisuaLex sources service (`/fetch_article_text`),
current text:

- art. 155 c.p.c.: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1940-10-28;1443:1~art155
- art. 147 c.p.c.: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1940-10-28;1443:1~art147
- art. 166 c.p.c.: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1940-10-28;1443:1~art166
- art. 2963 c.c.: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2963
- l. 742/1969, art. 1: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1969-10-07;742~art1
- l. 742/1969, art. 3: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1969-10-07;742~art3
- r.d. 12/1941 (ord. giud.), art. 92: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1941-01-30;12:1~art92

**GDPR (Regulation (EU) 2016/679), read on 28 November 2026** on EUR-Lex through the same service, Italian text:
art. 4(5), art. 35(1) and (3), recital 26: https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita

**Pseudocraft**, in LexCraft-IT/pseudocraft, read on 28 November 2026: its README (platform, interfaces, licence),
`pyproject.toml` (dependencies, build group) and `docs/installazione.md` (memory, disk, models).

**OWASP, read on 28 November 2026:**

- CSV injection: https://owasp.org/www-community/attacks/CSV_Injection (served from community.owasp.org)
- XML external entities: https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html

**Read on 23 November 2026:**

- **Tauri 2:**
  - notifications: https://v2.tauri.app/reference/javascript/notification/ and https://v2.tauri.app/plugin/notification/
  - autostart: https://v2.tauri.app/plugin/autostart/
  - dialogs: https://v2.tauri.app/plugin/dialog/
- **File watching**, the `notify` crate's known problems: https://docs.rs/notify/latest/notify/
- **Dropbox:**
  - conflicted copies: https://help.dropbox.com/organize/conflicted-copy
  - online-only files on macOS: https://help.dropbox.com/sync/online-only-mac
- **Apple**, iCloud Drive storage: https://support.apple.com/guide/mac-help/store-files-in-icloud-drive-mchle5a61431/mac
- **Obsidian:**
  - no encryption of the vault: https://obsidian.md/help/sync/security
  - links and block identifiers: https://obsidian.md/help/links
  - external changes: https://obsidian.md/help/data-storage

**In this repository:**

- `docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md` (M1);
- `apps/server/src/tasks/italianHolidays.ts`;
- `apps/server/prisma/schema.prisma` (`Dossier`, `Task`).
