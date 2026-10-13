# A decision's key passages — design

13 October 2026. Tranche 2, decisions. Question 166.

## The ask and the decision

The owner's document of 13 October: «Implementare la funzione di evidenziazione automatica dei
periodi e dei passaggi fondamentali all'interno della sentenza. Questo consente al professionista di
individuare al volo i passaggi decisivi per la propria pratica».

The recommendation was «prima le regole (principio di diritto, P.Q.M., passi che coincidono con le
massime), segnate come automatiche e mai mescolate alle tue evidenziazioni. L'IA dopo, se servono».
The owner, 13 October: «Ok proviamo».

## Where the ranges are computed

In the web, over `decisionProjection`: the projection is defined there, so the readers' output and
their caches stay untouched (root rule 23, `test_decisions_text_frozen.py`), and a passage is
recomputed on every render, so a reader fix can never leave a stale range behind.

## The rules, and what they measured

Measured on real decisions fetched through our own API and kept outside the repository: a tuning
sample (47 decisions with text: 35 Cassazione, 30 civil and 5 penal, and 12 Corte costituzionale) and then a held-out sample never looked at while writing the rules (11
Cassazione, 8 Corte costituzionale). Each passage was read and judged by hand. Aggregates only.

| Rule | Court | Tuning sample | Held-out sample |
| --- | --- | --- | --- |
| **Principio di diritto** | Cassazione | 17 passages in 15 decisions, 0 wrong; 15 of 15 decisions that state their own principle found | 3 of 3 right and whole; 1 decision missed (a formula the rules did not know, now added) |
| **Dispositivo** (the operative part, without costs and closing formulas) | Cassazione, Corte costituzionale | 43 of 43 right after tuning | 17 of 18 right (one kept the costs, cut fixed) |
| **The decision on each question** (the «considerato in diritto») | Corte costituzionale | 28 sentences, 0 wrong; 12 of 12 decisions | about 80 sentences, none wrong at reading; 7 of 8 decisions (a conflict of powers is not covered) |
| **Passages matching the massime** | Cassazione | 14 massime of 14 decisions: none near-exact (best: 64% of the massima's four-word sequences in one place); at 45% the place found was wrong in at least 2 of 5 | not run |

How near is «near-exact»: a span of up to five sentences holding at least 80% of the massima's
four-word sequences. Brocardi's massime are rewritten, not quoted, so none qualifies.

What the numbers mean and do not mean:

- **Principio di diritto.** The rule finds the Court's own enunciation («La Corte enuncia il seguente
  principio di diritto», «Va enunciato…», «…in applicazione del seguente principio di diritto»,
  the plural lists of the Sezioni unite) and refuses the principle a precedent stated («ebbe ad
  enunciare», «enunciò») and the one the Prosecutor General asked for. The passage is the quoted
  text, or the numbered list. Where the source's own text stops mid-sentence (3 cases) the passage
  stops with it. Part of the sample was found by searching that very formula, so recall outside
  such decisions is less certain than the 15 of 15 suggests.
- **Dispositivo.** Starts after «P.Q.M.» / «per questi motivi» / «LA CORTE COSTITUZIONALE» and stops
  before the costs, the «contributo unificato» formula, the anonymisation order and «Così deciso».
  A Cassazione text whose reader found no «P.Q.M.» has no dispositivo block (4 of 35, and 1 of 11
  held out): nothing is marked there.
- **Considerato in diritto.** Its start is where the paragraph numbering starts again at «1.» (right
  in 20 of 20). Marked: the Court's own sentences that a question is (non) fondata, inammissibile,
  or that a provision «va dichiarata costituzionalmente illegittima»; never an objection, a party's
  argument or a precedent recalled. A long decision with many questions gets many marks (one decision
  had about 60).
- **Massime.** Out: the rule misfires.

Other courts (Consiglio di Stato, TAR, the Union's courts) were not measured: nothing is marked on
them in this round.

## What the reader sees

1. **Its own sign, never a highlight's.** A passage is a dotted underline in a colour no highlight
   uses, with a small label at its start drawn by CSS (no character is added: root rule 23,
   `decisionRender.test.ts` stays green with the passages on).
2. **A legend and a switch.** The decision's toolbar holds «Passaggi chiave (n)»: a menu that says
   «Evidenziati automaticamente, non sono le tue evidenziazioni», lists the passages (Principio di
   diritto, Dispositivo, Decisione sulla questione 1…) to jump to, and switches them off. The
   switch is remembered in the browser's settings.
3. **«Fai tua».** A click on a passage opens a small popover: what kind of passage it is, «Fai tua»
   (a real highlight over the same words, through the ordinary highlight action; from then on it is
   the user's and the automatic sign under it is hidden), «Nascondi i passaggi chiave».
4. **Never stored, never exported.** The passages exist only on screen. Highlights, notes, the .txt
   and PDF exports, environments, the Forum and the account export read stored data only, so they
   never carry an automatic passage unless the user made it theirs.
5. **The preview (proposal).** The list preview of PR #169 shows, for a found decision, its first key
   passage — the principle, else the dispositivo — under «Passaggio chiave · evidenziato
   automaticamente», instead of the first lines (which for the Cassazione are the parties' names).

## Out of scope

AI-made passages; massime from other sources; the other courts; a server-side copy of the passages.
