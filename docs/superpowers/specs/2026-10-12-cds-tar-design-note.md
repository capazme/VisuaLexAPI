# Consiglio di Stato and TAR: a design note

**Status:** a note for the owner, no code. Written on 12 October 2026, after the CGUE design
(`2026-10-12-decisions-mcp-and-eu-courts-design.md`), to answer «per il 98 vediamo se riusciamo a
mettere gli scraper completi» for the administrative courts. Measured with five requests to
giustizia-amministrativa.it, three seconds apart, with VisuaLex's honest User-Agent.

## 1. What the source allows

**A full reader is feasible.** The text of a decision is published, and a server can find it.

- **Search.** The portal's «Decisioni e pareri» page (`/web/guest/dcsnprr`) is a form a server can
  post. It needs the session cookie and the form's anti-forgery token (`p_auth`), both read from
  one `GET` of the page. The form takes:
  - the seat: the Consiglio di Stato, the C.G.A.R.S. and the 29 TAR seats, named by city (Roma,
    Latina, Milano, Brescia…);
  - the year and the number of the decision;
  - the search mode.

  It answers with a list. Each row has the decision's type, the court and section, the case
  number (NRG), the ECLI, and a link to the document.
- **The document.** `mdp.giustizia-amministrativa.it/visualizza/?schema=cds&nrg=<NRG>&nomeFile=<anno><numero>_<code>.html`
  serves the decision as XML-like text: a block of metadata, then the decision in full, from
  «Il Consiglio di Stato in sede giurisdizionale (Sezione Sesta) ha pronunciato la presente
  SENTENZA» to «P.Q.M.», the operative part and the signatures. The newest decisions are PDFs.
- **A lookup is three requests:** the page, the search, the document.

## 2. What it means for the identity

**The number is not enough, even with the year.** The Consiglio di Stato numbers each kind of
measure in its own series. For n. 2270/2019 the search returns three different measures:

| Measure | Section | ECLI |
|---|---|---|
| sentenza | VI | ECLI:IT:CDS:2019:2270SENT |
| ordinanza cautelare | VI | ECLI:IT:CDS:2019:2270OCAU |
| parere interlocutorio | I | ECLI:IT:CDS:2019:2270PINTE |

Across the 2019–2026 results for n. 2270, the kinds seen were sentenza, sentenza breve, ordinanza
cautelare, decreto cautelare, decreto decisorio and parere. A TAR numbers by seat, so «n.
1234/2020» names a different decision in Roma and in Milano.

**Proposal:**

- **Two courts.** `consiglio_di_stato` (the C.G.A.R.S. as a seat of its own, `cgars`, since it
  numbers apart) and `tar`.
- **The key carries what the numbering needs.** It follows the convention's §2.4 («the court's
  own qualifiers in place of `archivio`»):
  - `consiglio_di_stato:<kind>:<numero>:<anno>`, where the kind is the ECLI's suffix in lower
    case (`sent`, `senb`, `ocau`, `dcau`, `ddec`, `par`…). A reference with no kind reads as a
    sentenza, as the words «Cons. Stato, n. 2270/2019» are meant in practice.
  - `tar:<seat>:<kind>:<numero>:<anno>` (`tar:roma:sent:1234:2020`).
- **The section is an attribute**, as for the Cassazione.
- **The ECLI is an attribute** that VisuaLex checks against the key.

## 3. Words

- «Cons. Stato, sez. VI, n. 2270/2019», «C.d.S.», «Consiglio di Stato, Ad. plen., n. 18/2021»
  (the Adunanza plenaria is a section).
- «TAR Lazio, Roma, sez. I, n. 1234/2020», «T.A.R. Lombardia, Milano»: the region is read as its
  main seat when no seat is named (Lazio → Roma, Lombardia → Milano…). Three regions have more
  than one seat, so a table of 29 seats and their regions is needed.
- «ord.», «decr.», «sent. breve» name the kind.

## 4. Questions for the owner (each with my recommendation)

1. **Identity.** The Consiglio di Stato by kind, number and year; a TAR by seat as well. Kind
   and seat are part of the key, the section is not. *Recommended.*
2. **A reference with no kind.** It is a sentenza. When the year holds no sentenza with that
   number, the answer is ambiguous and lists what the year does hold, rather than picking an
   ordinanza. *Recommended.*
3. **A TAR named by its region alone.** It reads as the region's main seat, with a notice. Where
   the region has other seats, the answer is ambiguous rather than silent. *Recommended.*
4. **Citation.** «Cons. Stato, sez. VI, sent. 8 aprile 2019, n. 2270»; «TAR Lazio, Roma, sez. I,
   sent. …, n. 1234». The style matches the Cassazione's. The date is the deposit date. The
   document's metadata seems to carry it (08/04/2019 for n. 2270/2019); the reader must confirm
   this before any label depends on it. *Recommended.*
5. **Pareri** of the Consiglio di Stato (advisory sections): not in the first slice. *Recommended.*

## 5. Cost and risks

- Three requests per lookup to a portal that is not an API. The form's field names carry a
  portlet instance id (`INSTANCE_XKc17mrB8J10`) that the site can change. The reader must read
  the form from the page each time, never hard-code it, and fail as `fonte_non_raggiungibile`,
  never as `non_trovata`, when the form is not where it was.
- The documents carry the names of the judges and, where they are not anonymised, of the
  parties. The cache rules of the other readers apply: 30 days, expired entries swept.
- Text contract (root rule 23): the reader keeps the decision's characters. It drops the
  metadata header, which is not text of the decision.
- Size: a reader, the seat table, the court in every place of the CGUE design's §5, and the
  words. About the CGUE's size again, plus the seat table.
