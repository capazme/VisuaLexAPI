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

The extractor's output for every file here is frozen (CLAUDE.md gotcha 23:
`article_text` is the offset space of every stored highlight and note).
