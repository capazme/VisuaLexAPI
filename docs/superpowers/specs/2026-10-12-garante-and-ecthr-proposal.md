# The Garante and the European Court of Human Rights in a dossier — proposal

**Status:** proposal answered, nothing built. It is what is left of `2026-10-08-mcp-decisions-design.md` (pull request #112) after `2026-10-12-decisions-mcp-and-eu-courts-design.md` and `2026-10-12-administrative-courts-design.md` built the rest. The owner answered §5 on 13 October 2026; a design for both can now be written.
**Decided already** (the owner's answers to #112 §7, 12 October 2026, as recorded in `2026-10-12-decisions-mcp-and-eu-courts-design.md` §1):

- Q5 — the Garante is **a new item type, «provvedimento»**, with a small design of its own; not a `sentenza` with a court of its own.
- Q6 — wanted, after the CGUE and the administrative courts: **Garante and ECtHR**.
- Q4 — a full reader where feasible; only where a source makes that infeasible is the first step «identified, verified to exist, cited and linked to the source», reported per source before falling back.

This document does not design either. It says what the user needs, what is known about each source, and what has to be measured before a design can be written.

## 1. Where it stands today

`omnilex_aggiungi_sentenze_dossier` reads the Cassazione, the Corte costituzionale, the courts of the Union and the administrative courts. Of the Garante or the ECtHR it answers which one it recognised and stores nothing — the right answer for now, and the one this proposal would replace with `added`.

Checked on 12 October 2026 through the MCP server: the eight decisions of the session that started #112 (six of the Consiglio di Stato, two of the Court of Justice) were all stored, verified and cited.

## 2. What the user needs

From the interview behind #112, with a user whose work is data protection:

- **The Garante's measures are cited as often as judgments** in that work, and in the same breath as them: an opinion or a course outline lists a measure of the Garante beside a judgment of the Court of Justice. A dossier that takes the judgment and not the measure is half a dossier for this kind of user.
- **The ECtHR is cited less often**, mostly for articles 8 and 10 of the Convention. It matters, but after the Garante.
- **Existence verified, as everywhere else.** Nothing unchecked is stored.

So, of the two, the Garante would come first; the owner chose to design and build them together (§5 Q1).

## 3. The Garante — what a design has to settle

- **Identity.** A measure is cited by date and register number («provv. <date>, n. <number>») and published with a web document number («doc. web n. <number>»). The owner decided (§5 Q5) that **date and register number are the identity**, as lawyers cite a measure; the web document number is an attribute, kept when the source gives it. To be measured: whether date and register number are unique across the kinds of measure, and how the source is searched by them.
- **What kinds enter.** Measures, injunction orders, opinions, guidelines, general authorisations. Proposed: every kind the site publishes with a web document number, with the kind kept as an attribute, as `tipo` is for a decision.
- **Source.** garanteprivacy.it. the Legal IT MCP server (the `vendor/mcp-legal-it` submodule) already has tools that search and read the Garante's measures, and `tools/archivio-normativo` uses them for enrichment; the API **reuses that reader** (§5 Q2), so a bump of the submodule is coordinated with whoever works on MERL-T.
- **Citation.** A form for the source convention's golden file: proposed «Garante privacy, provv. <date>, n. <number> [doc. web n. <number>]», the owner's to decide.
- **The item type.** «provvedimento» beside `norm`, `note`, `section`, `sentenza`: a strict content schema on the server with its twin on the web, as for `sentenza`; a key space of its own in `conventions/sources/`; the trash, the Forum proposals and the published environments, which rebuild every entry from closed values, must learn it too.
- **The tool.** Either `omnilex_aggiungi_sentenze_dossier` learns to store a «provvedimento» when it recognises the Garante, or a tool of its own does. One tool is less for the model to choose between; two keep "sentenze" honest. Decided: **one tool** (§5 Q3), whose description names decisions and measures.

## 4. The European Court of Human Rights — what a design has to settle

- **Identity.** Lawyers cite the case name, the date and the application number («<Applicant> c. <State>, <date>, ric. n. <number>/<year>»). The application number alone is **not** an identity: one application can have a Chamber judgment and a Grand Chamber judgment, and one judgment can join several applications. Candidates: the ECLI, or application number with the date. To be measured on HUDOC before choosing.
- **Language.** Judgments are in English or French; an Italian translation exists for some, not published by the Court. Decided (§5 Q4): the reader shows **the original text, with the citation in Italian**.
- **Source.** HUDOC. Not read by anything in this repository today. Whether it can be read reliably is the first thing to measure; if it cannot, Q4 of #112 already allows «identified, verified, cited and linked».
- **It is a court**, so it stays a `sentenza` with a court of its own, as the courts of the Union do.

## 5. Questions for the owner — answered 13 October 2026

1. **Order.** Garante first, ECtHR after (proposed), or together? — **Together**: one design, one round.
2. **The Garante's source.** The API reads garanteprivacy.it itself, or reuses the reader in `vendor/mcp-legal-it`? — **Reuse the reader in `vendor/mcp-legal-it`.**
3. **One tool or two** for decisions and measures? — **One**: `omnilex_aggiungi_sentenze_dossier` stores a «provvedimento» when it recognises the Garante.
4. **The ECtHR's language.** Original text with an Italian label, or only cited and linked when no Italian text exists? — **The original text with an Italian label.**
5. **The Garante's identity.** The web document number (proposed), or date and register number? — **Date and register number**; the web document number is an attribute.

## 6. Not part of this proposal

Passages highlighted through MCP in the norms of a dossier: a separate request, issue #151.
