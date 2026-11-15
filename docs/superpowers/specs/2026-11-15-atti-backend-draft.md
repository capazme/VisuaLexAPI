# Atti — backend draft (15 November 2026)

**Status: draft for Alfred and Guglielmo.** Written by Bill at the owner's request («fai le bozze di backend»), while
Alfred and Guglielmo are away. Not to merge without their yes: the data model is theirs to decide.

## Why

The owner wants the Atti section in the redesign (LC21, the prototype «interfaccia unificata (12-11)»). Until now the
web drew «Atti · in arrivo» over nothing: there was no table and no route. This draft is the smallest backend a first
Atti page can stand on.

## What is in it

- `Atto` (table `atti`): owner, optional dossier (`SetNull` when the dossier goes), `titolo`, free `tipo`, `testo`
  (plain text), `stato` `bozza | finale`, timestamps, the MCP provenance fields every user row has.
- `routes/atti.ts`, mounted at `/api/atti`, session only (not in the delegated table: an MCP token gets the
  default-deny 403): list (`?dossierId=`, newest change first, without the text), read, create, update, delete.
- Another user's act or dossier answers 404. Bodies are `strict` (no `userId` from a body). Text up to 500 000
  characters (under the 2 MB body limit with accented letters); no NUL. Writes go through `app.ts`'s
  `writeRateLimiter` (every non-GET under `/api`), as every other route's.
- `tests/atti.test.ts`: CRUD, validation, isolation between users, the dossier's deletion, the session. Full server
  suite green on the branch (2491 tests).

## Open questions (for Guglielmo and Alfred)

1. **Trash.** Deletion is final here. The dossier, its entries and the tasks go to the trash (`src/trash`): should an
   act too, with «Annulla»? (Bill's view: yes, before any user writes a real act.)
2. **Versions.** The prototype shows «bozza 2». One row per act, or a version per save (as `DossierSnapshot`)?
3. **Text format.** Plain text now. The editor will want headings, citations as links to the dossier's sources,
   footnotes: Markdown, ProseMirror JSON, or the AKN the Python service already speaks?
4. **The AI's proposals** on an act (the prototype's «1 proposta dell'IA da rivedere»): reuse `assistantProposals`,
   or a table of their own?
5. **MCP.** Should an assistant read or write acts (new scopes `atti:read`, `atti:write`)? Not in this draft.
6. **Account export and deletion.** The account's export (`accountData`) does not list acts yet; deletion cascades.
7. **Where acts live.** Server, as here, or only in the desktop app (D-101, the Anonimizzatore's case)? An act holds
   client data: Guglielmo's call on hosting it at all.
8. **A closed list of `tipo`** (atto di citazione, comparsa, appello, memoria…) or free text.

## Not in it

No web page: the Atti page waits for these answers. No migration of existing data (there is none).
