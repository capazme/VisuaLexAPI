# Normattiva fixtures

Whole pages, captured in August 2026 (the page shows "vigente al 26/08/2026"), one
per extractor branch of `NormattivaScraper.estrai_da_html`:

- `akn_comma_div.html` — scenario 1, `div.art-comma-div-akn` per comma.
- `akn_just_text.html` — scenario 2, `span.art-just-text-akn`.
- `abrogato.html` — scenario 2 again, a repealed article whose
  `div.ins-akn.art_abrogato-akn` sits inside the span (cod. privacy art. 3).
- `attachment.html` — scenario 3, `span.attachment-just-text` (an annex).
- `fallback.html` — scenario 4, none of the above.

Trimmed captures (the `div.bodyTesto` block exactly as Normattiva served it,
wrapped in `<html><body>`), taken 2026-09-19 from
`urn:nir:stato:regio.decreto:1930-10-19;1398:1~art524` / `~art544`:

- `cp_524_abrogato_malformed_trimmed.html` — c.p. art. 524, repealed by
  L. 66/1996. The markup is malformed: `<a><span class="attachment-just-text">
  <div>Codice Penale-art. 524</a> <br><br><div class="ins-akn
  art_abrogato-akn">…</div></span>`. After `html.parser` repair the abrogation
  div is a sibling of the `<a>`, outside the span the extractor reads, so the
  article came back as its label only (`'Codice Penale-art. 524'`, HTTP 200).
  The same shape affects c.p. 523-526, 530, 539, 541-543, 545-555.
- `cp_544_abrogato_trimmed.html` — c.p. art. 544, repealed by L. 442/1981,
  the healthy shape for contrast: the abrogation div is inside the span and
  the text reads `Art. 544. \n\n((ARTICOLO ABROGATO DALLA L. 5 AGOSTO 1981,
  N. 442))`.

Trimmed captures of 2026-10-02, for the validity reader
(`normattiva_validity.py`, spec `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`).
Each keeps the four blocks the reader looks at, as served — `div.vigore` (the window),
the update link, the "Ultimo aggiornamento" line and `div.bodyTesto` — wrapped in
`<html><body>`:

- `art1284_cc_at_2007-12-29_trimmed.html` — art. 1284 c.c. at 2007-12-29: a middle
  version, window 25-12-2003 to 29-12-2007, version 7. Both ends of the window.
- `art183bis_cpc_at_2010-01-01_not_yet_trimmed.html` — art. 183-bis c.p.c. at
  2010-01-01, before the article existed: the window only ends (12-9-2014) and the text is
  "… NON ANCORA ESISTENTE O VIGENTE".
- `art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html` — art. 183 c.p.c. at
  2015-01-01: a closed window and a "COMMA ABROGATO" notice among other commi, to prove
  that a partial notice is not the state "abrogated".

The portal prints the end of the window as `<span class="indent">al: <span id="artFine" class="rosso">29-12-2007</span></span>`
when the window has a start (the start is `<span id="artInizio" class="rosso">`, preceded by `&nbsp;`),
and as the bare text `<span>Testo in vigore al: 12-9-2014</span>`, with no `id` and no `class`, when it has none.

The extractor's output for every file here is frozen (CLAUDE.md gotcha 23:
`article_text` is the offset space of every stored highlight and note).
