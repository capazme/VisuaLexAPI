# D8, server and MCP: glosses in place of the assistant's highlights

Status: decided by the owners on 29 October 2026 (G-383, with G-381 (b)). Scope of this step: `apps/server` and
`apps/mcp`; the web shows glosses in a later step (a column of comments beside the text, as a word processor does).

## What changes

- **No more coloured passages proposed by an assistant.** Highlighting is the user's gesture. The MCP no longer
  registers `omnilex_evidenzia_passaggi_dossier`; `POST /api/dossiers/:id/items/:itemId/passages` answers 410 with
  the reason in Italian. Nothing is deleted or converted: the proposals already saved stay readable, validatable,
  movable and removable on the web app's side, as before (root rule 23: no character of any text, and no existing
  highlight, note or proposal, is rewritten).
- **Glosses.** Notes an assistant writes, validated by the user with the states that already exist (`proposed`,
  `validated`, `review`), editable:
  - the general gloss on a norm is the dossier note about the whole article (`about_item_id`): unchanged;
  - the gloss on a passage is new: a `Highlight` row of `kind = 'gloss'`, with no colour and a note that is never
    empty.
- **An entry's text is behind no switch** (`omnilex_leggi_testo_voce` and `GET …/items/:itemId/text`): it is how an
  application quotes a text verbatim.
- **The text of the user's notes** leaves through the MCP only under `dossier:text` («Leggere i testi»), whose
  consent words, and the «Dati personali» notice, now say «e le tue note», and only for a grant approved with those
  words: the grant stores the version of the words it was approved with (`oauth_grants.text_consent_version`), and
  the server answers a note's content null to any other connected application. Grants approved before keep today's
  behaviour until the user connects again.

## Why a `Highlight` row and not an anchored note

A gloss on a passage needs what a highlight already has and a dossier note has not:

- **Anchoring by `(startOffset, text)`** against the projection of the text, the contract of root rule 23, checked
  on real texts by `ruleTwentyThree.test.ts` and drawn by the web's renderer without touching the text's DOM.
- **The assistant's original position** (`assistant_start_offset`, `assistant_text`, never changed) and the user's
  **boundary move** (`range_edited_*`), from D7b.
- **The note states, the original note and the edit stamps**, also on the row since D7b, with the web app's routes
  for them (`routes/assistantProposals.ts`), the trash that carries them, and the rule that keeps an assistant's row
  out of `GET /highlights`, Study Mode, the Forum, environments and the PDF.

A dossier note is a list entry bound to a whole article: the schema says it is never a passage of its text. Giving
notes an offset would reopen that rule and duplicate the anchoring, the original position, the boundary move and
the trash in a second place.

## Model (migration `20261030100000_assistant_glosses`)

- Enum `HighlightKind` (`mark`, `gloss`); column `highlights.kind`, `NOT NULL DEFAULT 'mark'`: every existing row
  becomes a mark and keeps its colour.
- `highlights.color` nullable; `CHECK ((kind = 'gloss') = (color IS NULL))`.
- `CHECK (kind <> 'gloss' OR (created_by_client_id, note_state, note present and note not blank))`.
- `oauth_grants.text_consent_version INTEGER` (null for every existing grant; set to `TEXT_CONSENT_VERSION`, 1, when
  the user approves a request for `dossier:text`).

## Routes

- `POST /api/dossiers/:id/items/:itemId/glosses { glosse: [{ testo, nota, prima?, dopo? }] }`: delegated only,
  `dossier:write` and `dossier:text`, 1–10 glosses (quote 15–2000, note 1–1500 UTF-16 units), two points and one of
  the counter `passage` each, refused ones given back; the quote is located as D7b's passages were, the
  projection's own slice is stored; at most 30 open proposals per entry (glosses and saved marks together); a gloss
  repeats only the same application's gloss at the model's position. Answer: `{ voce, glosse: [{ esito: 'proposta', id } |
  { esito: 'rifiutata', motivo }] }`.
- `GET …/text` lists the glosses this application proposed still `proposed` (`glosse: [{ testo, nota }]`).
- The web app's routes answer each proposal with its `kind`; a gloss's note cannot be emptied (400).

## Switches

- `assistant_passages` (existing): the web app's side of everything an assistant proposed.
- `assistant_glosses` (new, off): the glosses route and the MCP's `omnilex_glossa_voce`. The glosses route needs
  both switches; this one is switched on only once the web shows glosses, since today's web draws an unknown colour
  as yellow.

## MCP

- `omnilex_glossa_voce`: `{ dossier, voce, generale? (≤ 4000), glosse[1–10] }`; the passages first, then the general
  gloss as a note about the entry; one outcome per row, no text.
- `omnilex_leggi_dossier`: with `dossier:text`, each note's first 500 characters (`troncata` when cut), and one
  note whole with `nota_intera`.
