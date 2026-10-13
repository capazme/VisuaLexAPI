# A decision's preview from the lists — design

13 October 2026. Tranche 2, decisions. A quick win: no question was asked to the owner.

## The ask

From the owner's document of 13 October, on decisions: «Permettere la consultazione rapida della
sentenza tramite una finestra pop-up già al primo stadio di selezione, evitando cambi di pagina
continui».

Until now the preview existed only for a decision cited inside a text, on hover
(`DecisionPreviewPopup`, design 2026-10-13 D5). From a list a decision opened at once beside the
practice, or, off the search page, on its address.

## The design

1. **A click (or Enter) on a decision in a list opens its preview, not the decision.** The preview
   is the hover popup's body (`DecisionPreviewContent`: the heading and first lines, «Con questi
   estremi esistono N decisioni», what the source says when not found or unreachable), fetched
   through `fetchDecisionCached`, so it costs one request per decision per session and the decision
   opened afterwards reads from the same cache.
2. **«Apri accanto» in the preview does what the click did before**: on the search page the
   decision opens beside (with the way back when the row has one); elsewhere (Cronologia, dossier)
   the button reads «Apri la sentenza» and goes to the address, which opens it in a practice.
3. **Where:** every list of decisions our reader opens.
   - `DecisionLink`, hence `CaseLawRow`: the Cassazione under an article and in a topic search's
     window, Brocardi's massime, the Court of Justice's judgments, and the Massimario's chips.
   - The Cronologia (`DecisionHistoryRow`).
   - A dossier's «Giurisprudenza» (`DossierDecisionsSection`, which now draws a `DecisionLink`).
   - Not: the Court of Justice's orders and the Advocates General's opinions (they open on EUR-Lex,
     our reader cannot); the palette, whose single decision is not a list and opens on Enter.
4. **Keyboard.** On the desktop the preview is the popup's frame as a non-modal `dialog` named
   «Anteprima di …», under the estremi and following them when the list scrolls. The focus goes to
   «Apri accanto»; Tab cycles inside; Esc, the X or a press outside closes it and the focus returns
   to the estremi (not after «Apri accanto», which hands the focus to the decision). A second click on
   the estremi closes it. The estremi carry `aria-haspopup="dialog"` and `aria-expanded`.
5. **Phone.** A bottom sheet (`ui/Sheet`, moved there from Studia), titled with the decision; the
   backdrop and Esc close it; «Apri accanto» opens the full-screen reader, as the store already does.
6. **The address stays the contract.** The estremi are a real `href`: ⌘/Ctrl-click and the middle
   button open a new tab, as before.

## Out of scope

The key passages (spec `2026-10-13-decision-key-passages-design.md`), which may later give the
preview a better first paragraph than the epigrafe.
