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
