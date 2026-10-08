# Court decisions through MCP, and the courts a dossier knows — proposal

**Status:** proposal, nothing built. Written for the owner to accept, cut or refuse; §7 lists what only the owner can decide. No code follows until then.
**Follows:** `docs/superpowers/specs/2026-10-01-sentenze-design.md` (decisions in the reader and in a dossier; its "Later" already names Consiglio di Stato, TAR and CGUE), `docs/superpowers/specs/2026-10-04-mcp-second-round-design.md` (the MCP tools, the delegated table, confirmation), `docs/superpowers/specs/2026-10-04-source-convention-design.md` (how a decision is identified and cited).

## 1. Where this comes from

A real session on 8 October 2026, in Claude Code, through the MCP server: a lawyer asked for a dossier holding every norm and every decision cited in a course outline, to check them by hand afterwards.

- The norms went in through `omnilex_aggiungi_norme_dossier` (the EU ones only in part: pull request #111).
- The eight decisions did not go in at all, for two separate reasons:
  1. **No MCP tool adds a decision.** The web app can (`POST /dossiers/:id/items`, `itemType: 'sentenza'`); the MCP server cannot.
  2. **None of the eight is from a court VisuaLex knows.** Six are of the Consiglio di Stato, two of the Court of Justice of the EU. A dossier's decision is `cassazione` or `corte_costituzionale` (`apps/server/src/schemas/decisionItem.ts`, `services/visualex/visualex_api/services/decisions/model.py`), so the web app could not have added them either.

The decisions ended in a plain note, as text: readable, but not entries, not cited by the convention, not checked by VisuaLex.

So the request "add decisions through MCP" is two pieces of work with very different costs. This document keeps them apart so that the first can be judged without the second.

## 2. What the user needs

From the interview with the user of that session:

- **References arrive in words**, as they are written in a document: «Cons. Stato, sez. VI, n. 2270/2019», «Cass. civ., sez. un., n. 31310/2024», «CGUE, C-634/21». Never as an identity object.
- **Existence must be verified.** A decision enters a dossier only if the source confirms it exists; one that cannot be checked is reported and not stored. This is the rule the norms tool already follows (`unavailable` is never "missing", and nothing unchecked is saved), and the user's own professional rule: nothing is cited that was not verified.
- **The courts needed in daily work**, beyond the two VisuaLex has: Consiglio di Stato and TAR, the Court of Justice of the EU, the Garante per la protezione dei dati personali (its measures are not judgments, but they are cited like them), the European Court of Human Rights.

## 3. Part A — a tool that adds decisions of the courts VisuaLex already has

### 3.1 The tool

`omnilex_aggiungi_sentenze_dossier`: 1 to N references in words, one decision per reference, into a dossier named by id or exact name. The twin of `omnilex_aggiungi_norme_dossier`, with the same shape of answer: one outcome per reference, the others never stopped by one that fails.

Outcomes, in the norms tool's words where they mean the same:

| Outcome | When |
| --- | --- |
| `added` | resolved to one decision, the source confirms it, stored |
| `already_present` | the same decision is in the dossier, or twice in the call |
| `not_recognised` | the words do not name a court, a number and a year |
| `court_not_supported` | a court VisuaLex has no source for (today: everything but Cassazione and Corte costituzionale); the answer names the court it read |
| `ambiguous` | Cassazione, same number and year in both archives and no archive given — `/fetch_decision` already answers `ambigua` |
| `does_not_exist` | the source answers `non_trovata` |
| `unavailable` | the source cannot be reached, or limits us |

Nothing is updated, moved or deleted. The stored content is what `decisionItemContentSchema` admits and nothing else; the label is recomputed by the server (`withDecisionLabel`), whatever the tool sent.

### 3.2 What it needs on the server

- **A parser from words to a `Reference`.** Today `parse_reference` reads a JSON object, and the spec of 1 October leaves "judgment citations recognised … (typing «Cass. n. 10787/2024»)" for later. This is the one new piece of logic in Part A. It belongs in the Python API, beside `parse_query` for norms, so that the command palette can use it later; the convention's golden file should pin its cases.
- **A route** `POST /api/dossiers/:id/decisions` `{ references }`, the twin of `/norms`: parse, `POST /fetch_decision` for existence, then one transaction.
- **An entry in the delegated table** (`oauth/delegatedRoutes.ts`), scope `dossier:write`, weighted per reference like `/norms`. `apps/server/CLAUDE.md` says it plainly: adding a route to that table is a security decision, since any MCP client the user connected can reach it. It is a write of the same kind the table already allows (it adds, never updates or deletes), but it is the owner's to allow — §7 Q1.

### 3.3 What it costs and risks

- Small: one route, one tool, one parser, their tests. No migration: `sentenza` items exist.
- **The quota.** `/fetch_decision` is slow for the Corte costituzionale on a cold bundle (the resolver's timeout is 240 s). A batch of references may outlast the tool call. The norms tool takes 50 references; decisions likely want fewer — §7 Q2.
- **It does not solve the case in §1.** With Part A alone, all eight references of that session answer `court_not_supported`. That answer is still worth having — it says why, instead of the model silently writing a note — but Part A is only useful to someone who cites the Cassazione and the Consulta.

## 4. Part B — more courts

The courts asked for, in the order the evidence suggests, with what each one needs. None of this is designed here: each line is a question about a source, and the answers decide the order.

| Court | Identity (proposal) | Source to verify existence | Known difficulty |
| --- | --- | --- | --- |
| Court of Justice of the EU | case number: `C-634/21` (and `T-…` for the General Court) | EUR-Lex, by CELEX | The 1 October spec notes the CELEX can be built from the case number. EUR-Lex is already read for norms, behind a WAF and a cache |
| Consiglio di Stato, TAR | court, section, number, year | giustizia-amministrativa.it | "Their readers need a search step first" (1 October spec). Number and year alone may not be unique across sections and seats |
| Garante privacy | measure's web document number (`doc. web n. …`) or date and number | garanteprivacy.it | Not a court: a new kind of source, with its own citation form. Possibly a different item type |
| European Court of Human Rights | application number, case name | HUDOC | Texts mostly in English or French; identity by application number, cited by case name |

What every new court touches, so that the cost is not underestimated:

- `decisionItemContentSchema` (server) and `parseSentenzaContent` (web), which must change together;
- the decision keys (`conventions/sources/decision-keys.json`, `readDecisionKey` and the web's `identityFromKey`);
- the citation (`norms/decisionCitation.ts`, the convention's golden file, the web's copy);
- a reader in `services/visualex/visualex_api/services/decisions/`, with its cache rules and honest `fonte_non_raggiungibile`;
- the reader's page for a decision of that court, or an explicit choice that such a decision is cited and linked but not read inside VisuaLex — §7 Q4.

The convention is the owner's (D9 and the source convention spec). Part B is therefore not something a contributor proposes as code.

## 5. What this proposal does not ask for

- No change to the confirmation rules, the trash, or the delete permission.
- No decision's text stored in a dossier: identity and label only, as today.
- No "unverified" entries. A court without a source is refused with a reason, not stored with a warning. (The alternative was put to the user and declined.)

## 6. Order proposed

1. Part A, as one pull request, if the owner allows the delegated route (Q1).
2. The CGUE, first of Part B: the source is one VisuaLex already reads, and the identity is simple.
3. Consiglio di Stato and TAR.
4. Garante and ECtHR, each after its own short design.

Each step is useful alone and none blocks the others.

**What the case in §1 needs, stated plainly.** Steps 1 to 3 together: the tool, the CGUE and the Consiglio di Stato. Step 1 alone answers all eight references `court_not_supported`; steps 1 and 2 store two of the eight. If the owner wants one useful slice rather than three, the smallest that stores a decision of that session is step 1 with step 2.

## 7. Questions for the owner

1. **The delegated route.** May `POST /dossiers/:id/decisions` enter the delegated table with `dossier:write`? It adds entries of an existing type, checked by the existing schema.
2. **How many references a call.** 50 like the norms, or fewer because one `fetch_decision` can take minutes on a cold Corte costituzionale bundle?
3. **Where the parser of words lives.** In the Python API beside `parse_query` (proposed), or in the server?
4. **A court VisuaLex cannot read.** For the Consiglio di Stato or the ECtHR, is "identified, verified to exist, cited and linked to the source, not read inside VisuaLex" an acceptable first step, or does a court enter only with its reader?
5. **The Garante.** A `sentenza` with a court of its own, or a new item type?
6. **Is Part B wanted at all, and in what order?** The "Later" of the 1 October spec says yes for three of the four; this asks whether now.

## 8. Related, seen in the same session (not part of this proposal)

Listed in pull request #111: a reference with the year only resolved to a wrong date; the web dossier page does not show what a connected application adds until it is reloaded; «Importa articoli da norma» offers no EU act types; the confirmation form answers an Accept with the box unticked like a Decline.
