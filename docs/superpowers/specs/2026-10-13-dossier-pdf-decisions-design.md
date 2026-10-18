# The dossier's PDF: its decisions, and only the marked passages

13 October 2026. Owner's answer to question 167, «Ok», on the recommendation: «entrambe le scelte
nella schermata di esportazione: «includi/escludi» per ogni sentenza e «solo le parti evidenziate e
annotate» per articoli e sentenze».

## What was wrong

«Esporta → PDF» printed the dossier's notes and its acts with their articles. The decisions a dossier
holds («Giurisprudenza») were not in it, and a lawyer who had marked three passages of a long text had
to print the whole of it.

## What the export does now

1. **«Esporta → PDF» opens a dialog** (`DossierPdfDialog`, a `ui/Modal`) instead of downloading at once:
   - **«Cosa stampare»**, two choices: «Testo completo» (the default, as before) or «Solo le parti
     evidenziate e annotate». The second applies to the articles and the decisions alike.
   - **«Sentenze»**, shown when the dossier holds decisions: one checkbox per decision, labelled with
     its citation (`decisionCitationOf`), all ticked; «Tutte» and «Nessuna».
   - «Scarica PDF», with the progress («Preparo il PDF… 3 di 7») while the texts load; «Annulla».
2. **The decisions are a section of their own**, «Giurisprudenza», after the acts, in the dossier's
   order, each headed by its citation and its heading line. A decision's text is the one the reader
   shows: `fetchDecisionCached` (the server's cached copy), laid out by `decisionPdfModel`, the model
   the single decision's PDF already uses, so its highlights are painted and its notes follow their
   paragraph exactly as there. A decision that cannot be read says «Testo non disponibile al momento»;
   a decision found without its text says so in the source's words (`describeNotice`).
3. **«Solo le parti evidenziate e annotate»** prints, for each article and each decision, the passages
   the reader highlighted or anchored a note to, in reading order, each followed by the notes anchored
   in it, with «[…]» where text was left out (before the first passage, between two passages that do not
   touch, after the last). Overlapping or touching anchors make one passage. A text with nothing marked
   says «Nessuna parte evidenziata o annotata». The notes about an article as a whole (the dossier's
   «Nota» on an article) and a decision's free notes are printed as in the full text.

## Root rule 23

The passages are cut from the text the anchors were made on, at the offsets `resolveAnchors` gives
over the same projection the reading surfaces use: an article's `article_text` without its `\n`, a
decision's `decisionProjection`. The PDF prints exactly those characters: nothing is re-scraped and
no character is normalised. A line break the projection hides comes back as a line break (an article:
the `\n` of `article_text` inside the passage; a decision: the boundary between its paragraphs and
lines, as `decisionPdfModel` already joins them). An anchor that no longer lands is not printed as a
passage; a decision lists it under «Non ritrovate nel testo attuale», as its own PDF does.

## Not in this change

- The article's full text keeps today's form (tags stripped, whitespace collapsed by `plain`): changing
  it is not asked for.
- The highlights of an article are not painted in the full text (they never were); in «solo le parti»
  they are what is printed.
- The PDF of one decision keeps its own button and options.
