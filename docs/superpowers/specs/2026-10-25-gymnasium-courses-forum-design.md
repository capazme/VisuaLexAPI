# Gymnasium — publishing, exploring and importing courses in the Forum (A3)

**Status:** draft of the idea, 25 October 2026, with one owner's answers of that day (§9); the licence waits for
both owners. It fixes what the A1 spec must make possible; the detailed design comes after A1 is built. Design only: no code, no migration.
**Target:** after A1 (release 1.11) and A2; not before.
**Depends on:** `2026-10-23-gymnasium-courses-design.md` (A1: courses, enrolments, competences, mastery, the
course's dossier). **Builds on:** the Forum's public dossiers (`SharedEnvironment`: publish, versions,
download, suggestions, reports, the administrator's withdrawal), the validation threshold spec
(`2026-10-18-studia-validation-threshold-design.md`), the owners' decision D-056 (prompts, rubrics, card
schemas and one's own tracks are public under CC BY-NC-SA 4.0).

## 1. Why

The owners want everyone to be able to turn their own lecture material or research into something useful for
themselves and for others. A course is created private (A1); once its author has passed it and finds it
useful, they publish it in the Forum; others explore the courses the community has made, see how they were
validated, and import them into their own Gymnasium.

## 2. The life of a course

1. **Private** (A1): created by the author's assistant, studied by the author.
2. **Passed by its author:** every competence «acquisita» and the final exam passed (A1, §4).
3. **Published:** after the checks of §3, the course and its dossier appear in the Forum.
4. **Explored and imported:** others read its page and enrol; each studies it with their own progress.
5. **Validated:** learners who pass it rate it and flag errors; validators review its content; it can earn
   «Verificato».
6. **Revised:** the author's changes make a new version; enrolled learners choose whether to move to it.
7. **Withdrawn,** by its author or by the administrator, as public dossiers are.

## 3. Publishing

A course can be published only when:
- its author's enrolment is «superato»;
- no item flagged in the author's enrolment is left unresolved (replaced or removed);
- every norm and decision it cites still resolves;
- the author accepts a **publication declaration**, a versioned text distinct from A1's: the material is the
  author's own work, or used with its author's consent; the course is published under the licence of §6;
- the author confirms the review of every item, on a screen that shows them one by one, since in A1 the author
  met each item only once, as a learner;
- a **preview** shows the course as others will see it, with a privacy check (names, personal data, client
  facts), as public dossiers have.

**Publishing and enrolling are human acts in the web:** no MCP tool publishes or enrols (decision 189).
The course's dossier is published with it as a public dossier, through the existing mechanism, and linked
from the course's page.

## 4. The Forum's «Percorsi»

- **A third area** beside «Dossier pubblici» and «Community»: `/forum/percorsi`.
- **The list:** title, subject, the free topic, «a cura di» the author (name or pseudonym, and a qualification
  «dichiarata dall'autore»), the number of competences and modules,
  the estimated days at the stated daily time, the signs of §5, the rating.
- **Filters:** subject, topic, «Verificato» only, length.
- **The course's page:** the competences, the modules' titles and lengths, the dossier, the author's note, the
  signs, «Iscriviti».
- **Enrolling** («import» in the owners' words) creates an enrolment of the reader on the published version;
  the course appears in their «Percorsi»; the dossier is copied into their space as public dossiers are
  downloaded today. The content is not copied: it stays the author's, versioned.

## 5. Validation and signs

**«Verificato», per module** (25 October, «come raccomandi»): each module (its lesson and its items) is approved
by validators with the card threshold (`SOGLIA_APPROVAZIONI`, today 2); an «errata» sends the module back to
the author instead of archiving the course; the course is «Verificato» when every module is. Validators need not
pass the course first: reviewing and passing are separate signs.


Two signs, never merged into one:
- **«Superato da N»:** how many learners passed it, shown only from 5 learners (decided 25 October), so that no
  single learner is identifiable; with their mean rating.
- **«Verificato»:** the content (lessons, items, model answers) reviewed by validators, with the threshold
  rule of the validation spec; a learner's flags go to the author and count against it.

A course without «Verificato» is shown as «della community», as the evidence asks: unverified AI-made items
carry error rates of 1–45% in the studies found.

## 6. Licence and rights

- **Licence:** one owner chose CC BY-NC-SA 4.0 on 25 October, after D-056 (prompts, rubrics, card schemas and
  one's own tracks under CC BY-NC-SA 4.0). Licences are decided by both owners together, and two facts weigh on
  it: the notice under which cards are proposed today (`PROPOSTA_SCHEDA` v1) says **CC BY-SA 4.0**, so a
  course under NC-SA would hold cards under another licence; and P-023 (CC BY-SA 4.0 for every public
  contribution) is still a proposal. Under BY-SA the licence itself lets VisuaLex use the work; under NC-SA
  VisuaLex needs a licence of its own from the author in the terms of use.
- **Rights:** only the author's own material, or material used with its author's consent; the declaration of
  §3 says so, and the reports of the Forum handle the rest. Whether a course built from someone else's
  lectures is an elaboration of their work is an inference to be checked by the owners, not advice.

## 7. Versions

- A published version is frozen: enrolments refer to it.
- The author's change is a new version; enrolled learners see «C'è una versione nuova» with what changed, and
  move to it or not. Mastery already acquired on unchanged competences is kept (inference: to be designed).
- **Withdrawal** (25 October): by the author, the course leaves the Forum and enrolled learners keep studying the
  version they have; by the administrator for a question of rights (someone else's material), access ends for
  everyone, with a notice (inference: serving it on would still reproduce the contested material).

**Derivatives.** CC licences with share-alike allow a learner to publish a modified version. Recommended, in
two steps: first **«Proponi modifiche»** to the author, with the Forum's suggestions mechanism; an accepted
proposal makes its author a **co-author** of the next version. Then, if the author declines or does not answer
within 30 days, the learner may publish their own version, shown as «tratto da <course> di <author>». After A3.

## 8. Attestation and incentives

- **Attestation** (25 October: only on «Verificato» courses): for a learner who passes a course with «Verificato»: a page that anyone can open from a
  link, with the course, its author, the competences and the date; it says «percorso superato su VisuaLex»
  and is not an academic title or a continuing-education credit. A personal choice to create it.
- **No points for enrolments,** which would reward volume. A mission for the author when a course earns
  «Verificato» (inference, from the evidence on rewards for mastery rather than completion).

## 9. Questions for the owners

Answered by one owner on 25 October: the author's name chosen per course, the account's name by default, an
optional qualification shown as «dichiarata dall'autore»; «Verificato» per module (§5); «Superato da N» from 5;
withdrawal as in §7; the attestation only on «Verificato» courses. Open:

1. **The licence** (§6), for both owners: CC BY-NC-SA 4.0, or CC BY-SA 4.0 as the cards' notice already says?
2. **Derivatives** (§7): «Proponi modifiche» first, one's own version after 30 days?

## 10. What A1 must already allow

Content apart from enrolments; content frozen once used; competences and mastery per enrolment; the course's
dossier linked and publishable; the course's items reviewable one by one. All are in A1, §10.
