# Changelog

What changed in VisuaLex, release by release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), grouped by area
rather than by kind of change: a reader looks for what moved in the part they
use. Versions and the release steps are in `docs/git-workflow.md`.

Each section is written from the merge titles of its release
(`sh scripts/release-notes.sh <previous tag> develop`). The GitHub release
carries, beside it, a short note in Italian for the people who use VisuaLex.

## [Unreleased]

Everything since v1.7.8: the first release of the unified repository, which
brings in the MERL-T line merged on 27 September 2026.

### Reading norms

- The text as at a date: the server states which version of an article it
  returns, the reader shows it, and a dossier keeps the version it saved and
  tells two versions apart.
- «Giurisprudenza» under an article: the massime as links, the Cassazione's
  decisions that mention the article, one row and one year control per
  source, and the Court of Justice under an article of the Union.
- The Massimario's annual reviews: the paragraphs that cite an article, read
  by year.
- One source convention (`conventions/sources/`) names norms and decisions
  everywhere — web, server, MCP and graph — and a copy of the text in force
  starts with its citation.
- Discussions on passages of the text, with their loading and error states.
- «Importa articoli da norma» offers Regolamento UE and Direttiva UE, by year.

### Court decisions

- A decision opens at its own address, its text read once and in paragraphs:
  the Cassazione (whole, from the court's PDF, which can be downloaded), the
  Corte costituzionale, the Court of Justice and the General Court, the
  Consiglio di Stato, the C.G.A.R.S. and the TAR.
- Decisions searched by cited norm or by text, and the Cassazione's by year.
- Decisions in the search space: from the palette, the address and the links;
  in a list a decision opens its preview first; decisions in the Cronologia.
- Notes, highlights and norm links on decisions, with the anchors that no
  longer land listed rather than dropped; discussions on decisions.
- Decisions cited in a decision or an article become links that open beside
  it, and a Corte costituzionale decision's own precedents too.

### Search and find

- «Cerca nel testo» on articles and decisions, as one floating window on
  Cmd/Ctrl+F, over one tab or every tab.
- A citation in the find window finds every form a decision writes it in:
  date first, ordinal commas, «e ss.», «del c.c.».
- A search field always on the search page, and ⌘K on every page.

### Workspace

- The practice table replaces the floating tabs: practices, decisions and
  windows kept in the store, a bar of practices, and articles or decisions
  read beside the practice, two at a time. Collections are gone.
- On a phone: reading full screen, the list of practices, page headers under
  the floating menu button.
- A quieter sidebar; Grafo and Assistente sit behind a per-user development
  mode.
- The Cronologia moves to the user menu, and the avatar counts the saved
  norms that changed.

### Dossier

- Grouped by act: each act named once with its title, its articles as
  «art. N — rubrica», notes first, and a PDF that carries every text. An EU
  act gets a title too.
- Court decisions kept in a dossier, under «Giurisprudenza».
- Notes about an article sit with it; an undo keeps a note on its article.
- A trash for 30 days: a dossier deleted from the site, with «Annulla», and
  what a connected application removed, restorable from the dossier.
- The dossier page shows what a connected application adds without a reload;
  the share link carries any character and still reads the old links.

### Studia (study cards)

- Study cards written, edited, listed and found under their article, anchored
  by the official URN.
- Reviewed with FSRS v4, with a daily goal and community subjects.
- Proposed to the community and validated by named validators; a card the
  community took up outlives its author's account.

### Connected AI applications (MCP)

- An MCP server for Claude Code and LibreLex, with an OAuth 2.1 authorization
  server, a consent page and the list of connected applications.
- Tools for dossiers, notes, study cards and court decisions (Cassazione and
  Corte costituzionale). Deleting needs its own permission and the user's
  confirmation in the client, and goes to the trash.
- «Collega un'app AI»: how to connect an application, with a notice on
  personal data there and on the consent page.
- The MCP server runs in the production stack.

### MERL-T

- MERL-T joins the product, behind `MERLT_ENABLED`.
- One vocabulary for the graph's writers and readers, with the graph and its
  vectors migrated to it; graph labels in the source convention, with a
  backfill for the ones already written.
- The Massimario's reviews enter the graph, the vectors and the bridge.
- Lazy ingestion of an ordinary act carries its date, number and annex, lands
  on the existing node, enters as a stub, and fails with a reason.
- The doctrine layer is «Dottrina», with its source credited; bulk ingestion
  runs on its own queue.

### Fixed

- Parsing references: «615bis» and «615 bis» are art. 615-bis everywhere;
  «nonies» is an ordinal; any spelling of a norm reaches its identity, EU acts
  by CELEX; a decree searched by its year gets its own date; an annex reaches
  the norm, its URN and its citation; an article refused in the annex named
  says where it is; the parser and the palette read back every label the
  source convention writes.
- A repealed article or act reads as abrogated, whatever its markup.
- The articles of one EU act are told apart in a dossier, and an act's title
  stays in its block.
- A database hiccup no longer logs users out; no duplicate requests.

### Security

- The scraping routes need a login, checked by the ingress.
- Forum proposals and shared environments are rebuilt from closed values when
  published and imported, so no publisher's text reaches a citation.
- The exported PDF's cache path stays inside the download folder.
- Each client is counted at its own address behind the ingress.
- Dependency advisories patched: express (qs, path-to-regexp), ip-address,
  brace-expansion, proxy-addr, source-map-js.

### Deployment and development

- One repository: every component in its place (`apps/`, `services/`,
  `tools/`, `infra/`), one stack with fixed names, data moved by
  `scripts/backup.sh` and `scripts/restore.sh`.
- `./start.sh --dev` and `--prod`: production images, the stack as Compose
  modules on three networks, `--prod --branch main|develop` pulling before it
  deploys, a daily backup timer and a reversible host firewall rule.
- The `develop` and `main` flow, with its CI checks; the same Claude Code
  rules for everyone; MERL-T's integration tests in CI against a disposable
  FalkorDB; server tests on `.env.test` alone.

## [1.7.8] - 2026-09-25

The last release of the line before the unified repository. Its history is in
`git log v1.7.8`.
