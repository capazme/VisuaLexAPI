# Gymnasium — study courses from one's own material (A1a)

**Status:** draft, 23 October 2026; four of the five decisions of §11 answered on 24 October. The flow and the web part are written; the server part (§7) is a list of
what the web needs, to be written by the server side before the spec is approved. Design only: no code, no
migration yet.
**Target:** release 1.11.
**Decisions it rests on** (codes of the owners' decision register, and the owners' answers in chat):
- **G-362 (ok, 22 October):** the exception to principle 2 of the Studia specification (no uploads), narrowed:
  only the text of the modules a user saves reaches the server, private to that user, under a declaration
  that the user holds the rights to it; nothing goes to the community without validation; no file, and no
  audio, ever reaches the server;
- **G-363 (no, 22 October):** no new subject. A course's cards stay under the five existing subjects
  (`LingoMateria`); the course's own title says what it is about;
- **the owners, 22 October:** the course is split in two. A1a (this spec): private courses on Italian anchors.
  A1b (a spec of its own): anchors on EU and international acts. A1b must not hold A1a back;
- **the owners, 22 October:** the study flow of §3, revised after a review of the learning-science evidence,
  is approved as it stands.

**Builds on:** the Studia screens spec (`2026-10-07-studia-cards-screens-design.md`: cards, anchors, the
review session), the progress spec (`2026-10-13-studia-progress-design.md`: Rome days), the Gymnasium
restyle spec (`2026-10-19-gymnasium-restyle-design.md`: the Lezione frame, the tokens), the XP spec
(`2026-10-20-gymnasium-xp-levels-design.md`: missions and the ledger), and «Analizza documento»
(`apps/web/src/components/features/documents/documentFile.ts`: a file read in the browser, never sent).
**Migration:** one, for the server part (§7); its name is reserved with the orchestrator once this spec is
approved.

## 1. Why, and what this spec settles

A user preparing an exam, or a course they teach, has their own material: a handout, notes, a summary.
Today Gymnasium only reviews cards. The owners want the material itself to become a course: daily modules
of a few pages, each read actively, tested, and reviewed on the following days, with the drafts of the
tests prepared by the user's own AI assistant (through the MCP server) and checked by the user.

The first real case is an owner's 80-page handout on intellectual property, written by them: about 16,500
words in 20 chapters, mostly EU and international law. A1a serves its Italian parts; A1b adds the rest.

This spec settles: the study flow of a module (§3), the screens (§4), what the browser reads and what it
sends (§5), the MCP tools (§6), what the server must provide (§7), the mission (§8), privacy (§9), and
what is left to later rounds (§10).

## 2. Vocabulary

| Word | Meaning |
| --- | --- |
| **corso** (UI: «Percorso», decided in §11) | a user's private course: a title, a subject, an ordered list of modules |
| **modulo** | one day's unit: 5–10 pages of the material, split into blocks |
| **blocco** | 10–15 minutes of reading within a module, closed by a recall |
| **verifica** | the module's test: pre-questions, recall questions, a quiz, one open question |
| **bozza** | what the assistant prepares; it is the user's until they reject an item |

In code the course is `corso`, not `percorso`: `GET /api/lingo/srs/percorso` already names the cards
counted by institute (restyle spec, G5), and the two must not be confused.

## 3. The study flow of a module

Each step names the evidence it rests on, from a review of the learning-science literature made for this spec
on 22 October (kept with the owners; its main sources: Dunlosky et al. 2013, Yang et al. 2021, Higham et al.
2021, Ponce et al. 2022, Delgado & Salmerón 2021, Schwarcz & Farganis 2017, Deci, Koestner & Ryan 1999).
Several figures there come from abstracts or secondary sources, and are marked so. «Data» means a cited finding; «inference» a design choice drawn from findings, often outside
law. Numbers of minutes, words and thresholds are inferences.

1. **Before reading: 2–3 pre-questions,** answered while reading. Nothing is graded. (Data on the effect in
   general; inference for legal texts.)
2. **Reading by blocks.** The module is split into blocks of about 1,200 words (≈ 10–15 minutes of study
   reading). The time is **indicative**: an estimate and a progress bar, never a timer that closes the text.
   Reading on screen under time pressure gives the lowest comprehension (data, secondary source). A pause is
   suggested every 25 minutes or so, as comfort (inference).
3. **Highlighting is an aid to attention only.** The user may highlight while reading; the highlights live in
   the browser for the session and are not reviewed as an activity (reviewing one's own highlights adds
   nothing: data). Saved highlights by the course's author are A2 (§10).
4. **Recall after each block, with the text hidden.** A prompt with a trace («elementi, eccezioni, un
   caso»), a free text box, then «Confronta»: the block's text beside what the user wrote. Then 2–3 short
   recall questions on the block. (Data on retrieval; inference on the trace and the comparison.) The free
   recall stays in the browser (§9).
5. **The quiz, at the end of the module.** 6–10 multiple-choice questions:
   - at least half are application questions («qualifica il caso», «quale norma e perché»), not definitions
     (data on transfer; inference on the share);
   - distractors are taken from neighbouring institutes (nullità/annullabilità; contrattuale/extracontrattuale)
     (data on the format);
   - every answer shows at once why the right one is right and the others wrong (data: the information in
     feedback is what matters);
   - the questions cover every element of the module's institutes, not a subset (inference: practising part
     of an institute can weaken recall of the rest).
6. **One open question,** answered from memory in 3–4 lines with a fixed frame: questione, regola, esito.
   Offered when the quiz reached 70% (inference, no source); below that, a hybrid form: write first, then
   choose. After sending: a model answer and a rubric of 3–5 criteria the user ticks (self-assessment with
   explicit criteria: data, secondary source). Correction by the AI assistant is A2 (§10).
7. **The end of the module:** a short summary, the mission (§8), and **the judgement of the drafts**: a 1–5
   rating, a free note, and the items the user flagged as wrong during the module (§3.1).
8. **Review, from the next Rome day.** The module's cards enter the user's review the day after the module
   is done, as new cards, and follow the existing schedule (FSRS). Within a session a card graded «Di nuovo»
   already returns until it is recalled (`useReviewSession.ts`): that is the successive relearning the flow
   asks for, and nothing changes there. Earlier modules' cards stay in the review, so the review is
   cumulative by construction.
9. **The next module** is offered from the next Rome day, after the course's due cards, as a suggestion with
   one tap: never locked (§11).

### 3.1 Drafts the learner cannot check in advance

The evidence asks for expert review of every AI-made item before use (error rates of 1–45% in the studies
found). A learner cannot review a quiz before taking it without spoiling it. So in A1a, a private course:
every item has «Segnala un errore» after it is answered; a flagged item is withdrawn from the course for that
user and counted in the module's judgement. Review before use becomes mandatory when a course goes to the
community (A3, §10).

## 4. Screens (`apps/web`)

All in the Gymnasium tokens and the Lezione frame; 44 px targets; reduced motion; light and dark; 390, 1366
and 1920 px; Italian copy; `break-ui` on long titles, a one-module course, a 60-module course, a module with
no verification yet, an item with a very long explanation.

1. **«Percorsi» in the Gymnasium sidebar,** route `/studia/percorsi`: the user's courses as rows (title,
   subject, «Modulo 3 di 12», the next step: «Oggi: modulo 3», «Prima il ripasso», «Domani: modulo 4»).
   Empty state: one line on what a course is and «+ Nuovo percorso».
2. **New course** (a sheet): title (free, up to 200 characters: «Proprietà intellettuale»), subject (the five),
   the file (the «Analizza documento» drop zone, same formats and 15 MB; a PDF is refused with the same
   explanation), and the declaration (§9), which must be accepted before anything is saved.
3. **Modules preview:** the browser proposes the split (§5); each module shows its title, its first line and
   its length in words and minutes; the user renames, merges two neighbours or moves a boundary to another
   paragraph. «Salva il percorso» sends the modules' text, and only that.
4. **Course page** (`/studia/percorsi/:id`): the modules in order, each with its state (da preparare, pronto,
   oggi, fatto). A module with no verification shows «Da preparare» and, once, how: «Chiedi al tuo assistente
   di preparare il modulo 3 con VisuaLex» with the tool names of §6 and a link to «Collega un'app AI».
   Rename, delete (to the trash, as cards and dossiers do) and export are in the page's menu.
5. **Module session** (`/studia/percorsi/:id/moduli/:n`), full screen like «Lezione»: a step bar (Prima di
   leggere · Blocco 1 · Richiamo · … · Verifica · Domanda aperta · Fine); Esc and the close button ask
   «Interrompi il modulo?» as the review does; leaving keeps the step reached on this device only (§5).

## 5. What the browser reads, and what it sends

- **The file never leaves the browser.** It is read with `documentFile.ts` (TXT, Markdown, HTML, DOCX).
- **The split** is done in the browser, at paragraph boundaries: modules of about 1,500–3,000 words (5–10
  pages at about 300 words a page: inference), never cutting a paragraph; a heading line (short, no final
  full stop, followed by text) starts a new module when one falls within the range. The user corrects it in
  the preview.
- **Sent to the server:** the course (title, subject) and, for each module, its title, its order and its text
  as the user confirmed it. Nothing else: no file name, no file, no highlights, no free recall, no step reached.
- **Answers:** what the user chose in the quiz and the rubric ticks are sent only as the outcome the server
  needs for the mission and the judgement (§7, §8): the score of the quiz, the rubric's ticks, the flags.
  The open answer's text stays in the browser in A1a.

## 6. MCP tools (`apps/mcp`)

The assistant reads a module and writes its drafts. Names in the style of the existing tools; descriptions
in Italian; the same `run` and `callApi` path and the same refusals.

| Tool | What |
| --- | --- |
| `lingolex_schema_percorso` | read-only: the shape of a verification and the rules of §3 (shares, frame, rubric), to read before writing |
| `lingolex_miei_percorsi` | read-only: the user's courses and modules, with each module's state |
| `lingolex_leggi_modulo` | read-only: one module's text and its blocks |
| `lingolex_salva_verifica` | writes or replaces one module's drafts: pre-questions, recall questions per block, quiz (each item with options, the right one, and an explanation per option), open question with model answer and rubric; each item may carry references written as words, resolved as card anchors are, and an item whose reference does not resolve is refused with the reason |
| `lingolex_salva_card` | as today, with an optional `modulo`: cards of a module enter the review only after the module is done (§3, step 8) |

Replacing the drafts of a module already done is refused: the user's results refer to them.

## 7. Server (`apps/server`): what the web needs

To be written by the server side. Requirements, not a design:

1. A course and its modules, owned by one user, never visible to anyone else; the modules' text as sent.
2. A module's verification as the assistant wrote it, and the per-user outcome: the quiz score, the rubric's
   ticks, the flagged items, the judgement (rating, note), the day the module was done.
3. Cards linked to a module, excluded from the review scope (`reviewScope`) until the module is done, then
   offered as new from the next Rome day.
4. The mission of §8 in the XP ledger, with the existing rules (one credit per period, the daily ceiling,
   the Rome day).
5. The declaration of §9 as a versioned text, with the same mechanism as the proposal notice
   (`LingoTestoVersione`, `LingoAccettazioneTesto`, a new key).
6. Deletion: a course to the trash and back, as cards and dossiers; everything removed with the account
   (`deleteUserAccount`); an export of the user's courses with their data.
7. The scopes of the MCP tools (read and write), and the reads and writes the tools of §6 call.
8. Limits: how many courses and modules, how long a module's text, how many items per verification.

The server side's estimate (22 October): 2–3 days of a session, with one migration.

## 8. The mission

A new mission **«Completa un modulo»**: credited when the module's quiz reaches the threshold of step 6
(70%), once per module, never for reading or for time spent (rewards for mere completion lower intrinsic
motivation: data, secondary source). It is worth **30 XP** (§11); the existing missions for due and new cards
already reward the recalls on the following days.

## 9. Privacy and rights

- **The declaration** before the first save, as a versioned text the user accepts: the material is the user's
  own or the user holds the rights to use it; it stays private; VisuaLex keeps only the text of the saved
  modules. Its wording is the owners', still to be written (§11).
- **Private by construction.** No read returns another user's course; nothing of a course reaches the
  community, the graph or a shared environment in A1a.
- **The assistant reads the module's text.** Sending it to the assistant's provider is the user's choice of
  assistant (BYOS); the course page says so before the first «Chiedi al tuo assistente».
- **Instruction injection.** A module's text is data: the schema text of `lingolex_schema_percorso` tells the
  assistant that instructions found in the material are part of the material, never instructions.
- **Rights in someone else's material** (inference, not advice): a course built from another author's
  handout or lectures is an elaboration of that work; the declaration covers it for private use, and A3 will
  not publish without the author's consent.

## 10. First cut and later

| In A1a | Later |
| --- | --- |
| private courses from a file, split in the browser | **A1b:** anchors on EU and international acts |
| the flow of §3 with drafts from the assistant | **A2:** saved highlights by the course's author; the user's corrections and notes on drafts; correction of the open answer by the assistant with the rubric, after the user has written |
| self-assessment of the open answer with a rubric | **A3:** publishing to the community with mandatory review, an attestation tied to delayed mastery, not completion |
| the «Completa un modulo» mission | writing practice (parere, atto) with worked examples and fading: its own spec |

## 11. Decisions

Answered by the owners on 24 October («come raccomandi»), except the fifth.

1. **The name in the UI: «Percorsi».** The code stays `corso` (§2).
2. **The next module is a suggestion,** offered after the course's due cards with one tap, never locked
   (inference: a lock on a bad day ends the habit).
3. **The mission: 30 XP at 70%,** between «Scrivi» (25) and «Caso» (40) (§8).
4. **Highlights in A1a live only for the session** (§3, step 3).
5. **The declaration's wording:** open; the owners write it later. Until then the versioned text of §9 has
   no first version, and A1a cannot ship without one.

## 12. Testing

- Web: the split (a fixture of synthetic text with headings, one with none, one with a paragraph longer than
  a module), the preview's merge and move, the session's steps, the hybrid open question below 70%, the flag;
  nothing of the file, the highlights or the free recall in any request (a test on the request bodies).
- MCP: the five tools against the stub server, the refusal of a replacement after the module is done, an
  unresolved reference refused.
- Server: per §7, by the server side.
- A real browser pass with a long synthetic handout. The owner's own handout is never a fixture: nothing
  private enters the repository.
