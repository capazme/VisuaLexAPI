Answers recorded from Italgiure's public SentenzeWeb (Ministero della Giustizia — CED) on
2026-10-02, through the requests ItalgiureReader makes. Only the court's heading of the text is
kept (at most 400 characters); no party's name. Re-record them when the live tests fail.

Before committing a re-recording, read each kept text and cut it before any party's or
counsel's name, address, tax code or other case detail: the 400 characters are an upper
bound, not a target.

`italgiure_snciv_10787_2024.json` was recorded while the source withheld that text (its notice
stands in `ocr`): `test_a_civil_decision` expects no text.

`corte_cost_2014_sample.json`: three records from the Corte costituzionale's open data
(dati.cortecostituzionale.it, bundle P_json2001_oggi.zip), texts cut to at most 600 characters,
and before the first name of a private person.
Source: Corte costituzionale — licence CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/);
this file is under the same licence.

Recorded on 2026-10-05, for the decision search route (plan `2026-10-05-norms-decisions-search`,
Task 1), from Italgiure's `sn.solr` endpoint directly (`rows=3`,
`fl=id,numdec,anno,datdep,szdec,tipoprov,kind`, `sort=pd desc`, highlighting on, one fragment per
hit at most 200 characters): raw Solr JSON, bodies exactly as received. Checked for a private
person's name in every fragment: none found (each snippet is a point of law, not a party or a
fact).

`italgiure_search_2043_cc.json`: `kind:"snciv" AND (ocr:"art. 2043 c.c." OR ocr:"art. 2043 cod.
civ.")` — 1,430 hits that day; the three most recent.

`italgiure_search_topic_chance_2043.json`: `kind:"snciv" AND ocr:"perdita di chance" AND
ocr:"art. 2043 c.c."` — 34 hits that day; the three most recent.

`italgiure_search_empty.json`: `kind:"snciv" AND ocr:"art. 99999 c.c."` — no such article: 0
hits, an empty `docs` and `highlighting`.

## `private/` — real decisions, local only

The repository is public, so the Cassazione's original PDFs (and their full Solr records, which
name counsel and companies) are not committed. `private/` is git-ignored; the PDF reader is
tested on synthetic PDFs (`tests/decisions_pdf_synth.py`, `tests/test_decisions_pdf_text.py`),
and `tests/test_decisions_pdf_text_local.py` runs the same rules on the real files when they are
there and is skipped when they are not.

Expected there, as `<kind>_<numero>_<anno>.clean.pdf` (bytes exactly as Italgiure served them)
and `<kind>_<numero>_<anno>.json` (the full Solr record, `fl=*`), four decisions identified by
court, archive, number and year:

- Corte di cassazione, civil (`snciv`), no. 26034 of 2026 — Sez. 1, Ordinanza, 7 pages;
- Corte di cassazione, civil (`snciv`), no. 26035 of 2026 — Sez. 1, Ordinanza, 7 pages;
- Corte di cassazione, civil (`snciv`), no. 5626 of 2022 — Sez. U, Ordinanza, 8 pages;
- Corte di cassazione, civil (`snciv`), no. 5628 of 2022 — Sez. U, Ordinanza, 14 pages (the
  dispositivo is headed «PQM.»).

To fetch them again (plan `2026-10-05-norms-decisions-search`, Task 2, Step 1): GET the archive's
homepage `https://www.italgiure.giustizia.it/sncass/` first, then a Solr query on `sn.solr` for
`kind:"snciv" AND numdec:<numero> AND anno:<anno>` with `fl=*`; the PDF is at
`https://www.italgiure.giustizia.it/xway/application/nif/clean/hc.dll?verbo=attach&db=snciv&id=<filename with ".pdf" replaced by ".clean.pdf">`,
in the same session. At least 2.5 s between requests. Read each file for a natural person's name
before relying on it; never copy any of it into a committed file.

`italgiure_index_2043_cc.json`: `kind:"snciv" AND rnc-gen:"CC" AND rnc-art:"2043 00"`,
`sort=pd desc`, `fl=id,numdec,anno,datdep,kind,tipoprov,szdec,rnc-gen,rnc-art,rnc-sp,rnc-num,
rnc-dat` — `numFound` 3,904 that day; the first five of that exact query (sliced from a
`rows=100` read of the same query, used to measure the false-match rate; a `rows=5` request
returns the same first five, since the sort is deterministic). No party's text is in this file:
it is the index's own coordinate fields, nothing else.
