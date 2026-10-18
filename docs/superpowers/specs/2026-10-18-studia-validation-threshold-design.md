# VisuaLex Studia: the validation threshold set by an administrator

Date: 18 October 2026. Release 1.8.0. Builds on `2026-10-07-studia-cards-screens-design.md`,
decision 14 («provisional default, to confirm with the other developer»): the two numbers stop
being constants and become settings an administrator changes.

## 1. What is configurable

| Setting | Meaning | Range | Default (today's value) |
| --- | --- | --- | --- |
| `SOGLIA_APPROVAZIONI` | approvals needed to validate a proposed card, with no «errata» | 1–5 | 2 |
| `SOGLIA_ERRATE` | «errata» votes needed to archive a proposed card | 1–3 | 1 |

The defaults stay in code and in the migration that seeds the rows, so nothing changes until an
administrator changes a value.

## 2. Where it lives

**Storage.** A small key/value table, `lingo_impostazioni` (one row per key, the key an enum), and an
append-only log, `lingo_impostazioni_log` (who, when, old value, new value). The database checks the
range of each key (a `CHECK` that is not in Prisma's model, as for other checks in this schema), and
`lingo/validationSettings.ts` checks it again on input.

**Rule.** `lingo/validationRule.ts` keeps `SOGLIE_PREDEFINITE` and takes the thresholds as a
parameter: `stateAfterVotes(votes, soglie)`. The rule is unchanged; only its numbers come from the
store. The vote route reads the thresholds **after** locking the card row (see §4).

**Routes** (administrators only, `routes/adminStudiaSoglie.ts`, mounted on `/api/admin/studia/soglie`):

- `GET /` — the two current values, their ranges and defaults.
- `POST /anteprima` — `{ approvazioni, errate }`: how many proposed cards would become validated (`validate`)
  and archived (`archiviate`) with those values. Read-only.
- `PUT /` — `{ approvazioni, errate }`: saves both values, recomputes every proposed card, writes one
  log row per value that changed, and answers with the values and the counts actually applied.

**Web.** Two number fields and «Salva» in the admin tab «Testi di VisuaLex Studia», above the texts.
Before saving, the admin sees «Con questa soglia N schede diventano validate e M archiviate» (from
`POST /anteprima`). The admin area is the only place the values can be changed.

## 3. Cards already voted when the threshold changes

- Only cards in state `PROPOSTA_COMMUNITY` are recomputed, from the votes already cast, with the
  rule above. Cards already `VALIDATA` or `ARCHIVIATA` never change, whatever the new values.
- The recompute runs in one transaction with the saved values, so no half-applied change is visible.
- An archived card whose author's account is gone is deleted, as the vote route already does: nobody
  could see it, and the vote route's rule is kept.
- The preview is advisory. Votes may land between the preview and the save; the save answers with
  the counts it applied, and the page shows those.

## 4. Concurrency

- `PUT /` locks the proposed cards by id first, then the two setting rows (`FOR UPDATE`), and
  recomputes only the cards it locked: a card proposed after the lock has no votes yet, so it needs no
  recompute. Two administrators' changes take turns on the settings rows.
- The votes of the locked cards are read after their lock, so a vote that committed before the lock
  is counted; a vote still in flight finishes first.
- The vote route locks its card first, then reads the thresholds with a plain read. Under READ
  COMMITTED that read sees every threshold committed before it, so a vote can only use a value
  that is already stored, and its card is then recomputed by the change or by the next vote.
- The lock order is the same everywhere: cards by id, then settings. Account deletion (cards of the
  person first, then the user row, whose delete sets the settings' author to null) follows it, so the
  two cannot deadlock. A vote takes one card lock and nothing else.
- The rows of the two keys are inserted if missing (`ON CONFLICT DO NOTHING`) before they are locked:
  a test database truncated by the suite has none.

## 5. Who reads the rule

`stateAfterVotes` is called only from the vote route. The review queue (`lingo/reviewQueue.ts`) and
the progress dashboard (`lingo/progress.ts`) read the stored state and do not compute it, so they
follow a threshold change through the recompute. The web's «validata da N» counter, if shown, reads
the stored count of approvals, not a constant. A grep for the two constants is part of the verification.

## 6. Out of scope

- The RLCF weighted sum (decision 14 says it can replace the rule later).
- A `SOGLIA` per subject or per validator.
- A «seed origin» column for the seed cards (a schema change for a later round).
- The release itself (1.8.0 tagging and CHANGELOG) is a separate step, outside this spec.
