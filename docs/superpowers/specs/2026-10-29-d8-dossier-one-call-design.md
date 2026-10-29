# D8 S1 — a dossier in one call, and its cost measured

Status: decided by the owners on 29 October 2026; the answer's three keys (`dossier`, `entrate`,
`non_entrate` with `riga` and `motivo`) agreed with mcp-legal-it's maintainer. The two keys that appear
only when they apply (`note_non_entrate`, `errore`) and the mapping of a court VisuaLex cannot read to
«non verificabile» are this step's choices, for the owners to confirm. Part of D8 («MCP più leggero e glosse»); the glosses are
`2026-10-29-d8-glosses-design.md`.

## Why

A lawyer loads the documents of a practice and wants the dossier with its norms, decisions and notes
at once. With the tools as they were, that took one call to create the dossier, one per batch of 50
norms, one per batch of 10 decisions and one per note: each call makes the client send the model the
tool definitions and the conversation so far again, and the norms' answer carried a citation and a
reason for every row. Usage went there.

## What changes (apps/mcp)

1. **`omnilex_crea_dossier`** keeps its name and takes, optional: `riferimenti` (≤ 50 strings in
   words), `sentenze` (≤ 10 strings) and `note` (≤ 10 `{ testo ≤ 4000, voce? }`). `voce` is one of the
   call's `riferimenti`, written the same; without it the note is on the dossier. A note on a
   decision does not exist (the server's notes are about an article): a `voce` that is not one of
   the `riferimenti` refuses the call before anything is created. One call creates, verifies at the
   sources and adds.
2. **The answer**, compact, with no text and no citation:
   `{ dossier: { id, nome, tipo }, entrate: { norme, sentenze, note }, non_entrate: [{ riga, motivo,
   candidati? }] }`. `riga` is the input string byte for byte (never trimmed or normalised:
   mcp-legal-it subtracts it from its own list). `motivo` is one of «non riconosciuto»,
   «inesistente», «ambiguo» (a decision's with at most three `candidati`, in words), «non
   verificabile» (a source that did not answer, or a court VisuaLex cannot read yet), «già presente».
   Rows that entered are not repeated, nor is a row written exactly as one that entered (its string
   is in the dossier: reported «già presente», a client subtracting it would lose both). Two keys appear only when they apply: `note_non_entrate:
   [{ nota, motivo }]` (the note's position, 1-based, and why: its `voce` did not enter, or the
   server's reason), and `errore`, once the dossier exists, for a step the server refused whole (the
   daily points, a revoked connection) or answered with something unreadable: its rows are «non
   verificabile» and the other steps still run. Once the dossier exists nothing is thrown, so its id
   always reaches the model.
   The steps can take minutes: a client that sent a `progressToken` gets a progress notification after
   each, one that cancels stops the steps not yet begun, and the description tells the model to look
   for the dossier with `omnilex_elenca_dossier` before repeating a call left without an answer (a
   second call would create a second dossier).
3. **`omnilex_aggiungi_nota_dossier`** takes `note` (1–10 `{ testo, voce? }`, `voce` the entry's id)
   in place of the single `testo`/`voce`, which is gone: one shape, a smaller definition. It answers
   `{ dossier, entrate: [{ nota, id, nota_su }], non_entrate?: [{ nota, motivo }] }`; every note
   refused for the same reason is an error, as a single refused note was.
4. **`SERVER_INSTRUCTIONS`**: a dossier is one call with the list; the references are not checked
   first with other tools, since VisuaLex checks them at the source.

## How it reaches the server

The MCP calls the routes that exist — `POST /dossiers`, `POST /dossiers/:id/norms`, `POST
/dossiers/:id/decisions`, then `POST /dossiers/:id/notes` once per note — in that order, each with
its own exchanged token. The model sees one tool call either way, so a batch route on the server
would save no round trip of the model's, and reusing the routes keeps their checks, the delegated
table, the points, the daily counters (10 dossiers, 100 notes) and the refunds exactly as the
separate tools spend them. Norms then decisions, in sequence: the entries keep the order of the call,
and the two routes' position counters never race. The one server change is additive: an ambiguous
decision's candidates as a list (`candidates`, beside the `detail` that already named them), so the
MCP never parses a sentence; `omnilex_aggiungi_sentenze_dossier` leaves it out of its own answer,
whose `detail` already names them. No migration, no new route.

## The measure

`apps/mcp/scripts/costo-dossier.mjs` drives the server as a client does, against the test stubs (no
network: the stub answers each reference by a fixed rule), through the fixed case: AgID's «Bozza di
linee guida per il procurement di IA nella Pubblica Amministrazione - Versione 1.0» (in public
consultation from 12 March to 11 April 2026), its §2.2 and the articles its text cites, 26
references with the document's typo kept («reg. (UE) 2012/1025»), and eight notes. It counts calls
and the characters of the definitions, of the arguments and of every answer, on the path of one call
per step and on the one-call path, and estimates the context the client sends again at each call.
`tests/costoDossier.test.ts` holds the one-call path to exactly one call.

## Not here

mcp-legal-it's own definitions (the larger share of the cost when both connectors are on) are its
maintainer's work. The glosses tool and the web are other steps of D8.
