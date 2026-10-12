# The administrative courts: Consiglio di Stato, C.G.A.R.S. and TAR — Design

**Status:** the convention (this document and `conventions/sources/tar-seats.json`) before any
code. The golden file gains these courts' cases with the code that asserts them, in the same pull
request (`conventions/sources/README.md`, «Changing it»): their statuses are the ones this document
gives, `decided` for D1–D5, `proposed` for the rest. The owner took every recommendation of D1–D5 of the design note
(`2026-10-12-cds-tar-design-note.md`, PR #130) on 12 October 2026: «continuiamo», relayed by the
orchestrator, with the Consiglio di Stato's pareri left out. What the note did not ask is marked
`proposed` in the golden file: low-impact calls the owner can overturn.
**Follows:** `2026-10-12-decisions-mcp-and-eu-courts-design.md` (the courts of the Union: same
shape of work), `2026-10-04-source-convention-design.md` §2.4 («the court's own qualifiers in
place of `archivio` when its numbering needs them»).

## 1. What was measured

On giustizia-amministrativa.it, 12 October 2026, seven requests three seconds apart:

- **The Consiglio di Stato numbers each kind of measure in its own series.** «n. 2270/2019» is a
  sentenza (sez. VI), an ordinanza cautelare (sez. VI) and a parere (sez. I); the ECLI carries the
  kind (`ECLI:IT:CDS:2019:2270SENT`, `…OCAU`, `…PINTE`). Two decrees of different kinds can share a
  number in one year (`DCAU` and `DDEC` 2270/2021).
- **A TAR numbers per seat**, and the same holds there: TAR Roma n. 1234/2020 is an ordinanza
  collegiale, a decreto decisorio and an ordinanza cautelare (`ECLI:IT:TARLAZ:2020:1234OCOL`, …).
  The ECLI names the region (`TARLAZ`); the portal and the documents name the seat.
- **Sections** are written «SEZIONE 6», and at the TAR of Rome «SEZIONE 2Q» (II-quater).
- **The text** is published whole: the court's XML for decisions until 2025, PDFs since.

## 2. Identity (D1)

| `corte` | Court | Qualifiers in the key |
|---|---|---|
| `consiglio_di_stato` | Consiglio di Stato | the kind |
| `cgars` | Consiglio di giustizia amministrativa per la Regione siciliana | the kind |
| `tar` | a Tribunale amministrativo regionale | the seat, then the kind |

- **The kind** is the ECLI's suffix in lower case: `sent` (sentenza), `senb` (sentenza in forma
  semplificata), `ocau` (ordinanza cautelare), `ocol` (ordinanza collegiale), `dcau` (decreto
  cautelare), `ddec` (decreto decisorio); the reader keeps any other suffix the source gives,
  lower case, letters only. Pareri are left out (D5).
- **The seat** is one of the 29 in `conventions/sources/tar-seats.json` (`roma`, `latina`,
  `milano`, `brescia`, …), with its region.
- `numero` 1–99999 (the portal's field takes five digits), `anno` from 1990 (the portal's first
  year with texts; proposed).
- **Key:** `consiglio_di_stato:sent:2270:2019`, `cgars:sent:5:2020`, `tar:roma:ocau:1234:2020`.
- **Path** (proposed): `/sentenze/consiglio-di-stato/2270/2019`, the kind in the query when it is
  not a sentenza (`?provvedimento=ocau`); `/sentenze/tar-roma/1234/2020`; `/sentenze/cgars/5/2020`.
- **The section is an attribute**, as for the Cassazione: `I`…`VII` for the Consiglio di Stato,
  `plenaria` for the Adunanza plenaria, and at a TAR the Roman number with its suffix
  (`II-quater`, `III-bis`).
- **The ECLI is an attribute.**

## 3. Labels (D4)

| Decision | citation | short |
|---|---|---|
| Cons. Stato 2270/2019, sentenza, sez. VI, published 8 April 2019 | `Cons. Stato, sez. VI, sent. 8 aprile 2019, n. 2270` | `Cons. Stato, sez. VI, n. 2270/2019` |
| Adunanza plenaria | `Cons. Stato, ad. plen., sent. 9 novembre 2021, n. 18` | `Cons. Stato, ad. plen., n. 18/2021` |
| TAR Roma 1234/2020, ordinanza cautelare, sez. I, date not read | `TAR Lazio, Roma, sez. I, ord., n. 1234/2020` | `TAR Lazio, Roma, sez. I, n. 1234/2020` |
| a TAR of a region with one seat | `TAR Toscana, sez. II, sent. <data>, n. <n>` | `TAR Toscana, sez. II, n. <n>/<anno>` |
| C.G.A.R.S. | `C.G.A.R.S., sent. <data>, n. <n>` | `C.G.A.R.S., n. <n>/<anno>` |

- The court as lawyers abbreviate it: «Cons. Stato», «TAR <Regione>», «C.G.A.R.S.».
- **The seat** is named only where the region has more than one (Lazio, Lombardia, Puglia,
  Emilia-Romagna, Sicilia, Calabria, Abruzzo, Campania, Trentino-Alto Adige), as the citation
  needs it to tell them apart (proposed).
- **The kind** as an abbreviation: `sent.` for `sent` and `senb`, `ord.` for `ocau` and `ocol`,
  `decr.` for `dcau` and `ddec` (proposed); the kind's full name is on the decision's tab.
- **The date** is the day of publication (deposit) the document's metadata gives
  (`dataPubblicazione`), as for the Cassazione; with none, the number carries its year.

## 4. Words

What the parser reads (golden file, `decision_citations`):

- the court: «Cons. Stato», «Cons. St.», «C.d.S.», «Consiglio di Stato»; «TAR», «T.A.R.»,
  «Tribunale amministrativo regionale» followed by a region and, optionally, a seat («TAR Lazio,
  Roma», «T.A.R. Lombardia, Brescia», «TAR Toscana»); «C.G.A.R.S.», «C.g.a.», «CGARS»;
- the section: «sez. VI», «Sez. 6», «ad. plen.», «Adunanza plenaria», «sez. II-quater»;
- the kind, when the words name it: «sent.», «ord.», «decr.» (a family: the reference says
  `sentenza`, `ordinanza` or `decreto`, and the source says which kind);
- number and year as for the Cassazione («n. 2270/2019», «n. 2270 del 2019», a date's year).

## 5. Resolution (D2, D3)

- **No kind named** (D2): the reference is a sentenza (`sent` or `senb`). When the year holds no
  sentenza with that number, the answer is `ambigua` and lists what the year does hold — never an
  ordinanza chosen for the reader.
- **A family named** («ord.»): its kinds; two of them with that number (`ocau` and `ocol`) are
  `ambigua`.
- **A TAR named by its region** (D3): the region's main seat is searched first; when the region has
  other seats, they are searched too, and two seats holding the number are `ambigua`. A decision
  found at the main seat carries the notice `sede_dedotta`.
- **Not found** at the source is `non_trovata`; a page that is not the one the reader knows is
  `fonte_non_raggiungibile`, never «not found».

## 6. What it touches

As for the courts of the Union (design 2026-10-12 §5): the model, the reader and the resolver; the
words; the item schema on the server and the web together; the keys; the citation in three
languages; the decision's tab (the identity line, the source line, «Apri sulla fonte»: the
document on mdp.giustizia-amministrativa.it). Pull requests: this convention; the reader (#130,
then the rest of the Python side); the server, MERL-T and the web.
