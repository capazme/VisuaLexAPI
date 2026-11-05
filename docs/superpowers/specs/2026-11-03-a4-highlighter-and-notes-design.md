# A4: the highlighter and the notes, as a word processor has them

Status: asked for by the owner on 3 November 2026 (A4 of the proposal on removing a highlight, the owners' vault).
Web only: creating, recolouring and deleting a highlight exist on the server already (`apps/server/src/routes/highlights.ts`:
`POST`, `PUT /:id` with `color`, `DELETE /:id`). No route, schema or migration changes.

Two pull requests, in this order:

1. **The highlighter as a tool** (§1–§5 below): this document's first round.
2. **The note as a tool and the notes beside the text** (§6): the second round, its plan written when the first is
   merged.

## Why

A co-owner could not find a comfortable way to delete a highlight: the only one was the block's sign in the margin,
then its popover, then the bin. The owner asked for the word processor's gestures instead of another popover:
«Piuttosto che far uscire il pop up metterei dei toggle per il tool evidenzia + tool inserisci nota»; «nessun
riquadro»; re-highlighting highlighted words takes the highlight away, another colour overwrites it, and «Nessun
colore» clears; the cut «come in Word»: only the selected piece changes.

## 1. The highlighter button

The colour menu of the reading bars (`HighlightColorMenu`) becomes `HighlighterButton`, a split button:

- **Left**: the highlighter's icon over a short bar of the current ink (the colour's tint inside its ink; dashed, with
  no tint, for «Nessun colore»). A toggle: `aria-pressed`, named «Evidenziatore (giallo)» / «Evidenziatore (nessun
  colore)», its `title` saying what a press does.
  - With words selected in a reading text, a press applies the ink to them at once (§3) and leaves the tool as it was.
  - With nothing selected, a press turns the tool on (the button stays pressed); pressed again, or Esc, turns it off.
  - The press keeps the selection: `mousedown` is prevented on the button, and the selection is read as the press
    starts.
- **Right**: the arrow opens the menu (`MenuButton`): the four colours with their meanings, as before, then «Nessun
  colore». As in the word processor, a colour chosen with words selected applies to them; chosen with nothing
  selected, it turns the tool on with that ink. The selection is read when the press on the arrow starts, before the
  menu takes the focus.
- The gear to the colours' meanings stays beside it (none in Study Mode's header, which has its own, nor in a lesson).
- On a phone the reading bar has no room for three buttons: its row gains the left button (44 px), and the colours,
  with «Nessun colore», stay at the end of «⋯» under their title, where choosing one sets the ink.

**The ink.** `settings.highlightColor` stays the saved colour (H1). «Nessun colore» is the session's
(`highlighterEraser`, never saved): after a reload the ink is the last colour chosen. Choosing a colour clears it.

**The tool's state** is the store's, session-only (`readingTool`, absent from `partialize`): one tool for the whole
app, as in a word processor, so every bar shows it pressed. It is turned off by its button, by Esc (unless the key
belongs to a dialog, a menu, a field or a popover that has the focus), at logout, and when the last bar holding a
highlighter button leaves the screen (nobody is left to see it on).

## 2. The tool on

- The text takes the highlighter's cursor (the eraser's for «Nessun colore»): a class on the selection's container
  (`vlx-inking`, `data-ink`), drawn by `index.css`; nothing changes in the text (root rule 23).
- **Every selection is applied as it is released** and the selection bar does not appear: on `mouseup` with a mouse
  or a pen; on a touch screen once the finger has lifted and the selection has stood still for 700 ms (the selection's
  handles move it without any event the page sees, and applying at the release of a long press would take one word
  only). The selection is cleared once applied.
- A click that selects nothing does nothing: links, citations, signs and references keep their clicks.
- A text that takes no highlight (a past text, `copyOnly`; Gymnasium's validation reader) ignores the tool.

## 3. The rules

The same with the tool on, with the button pressed over a selection, with the menu's colour, with H and «Evidenzia» in
the selection bar, and with Study Mode's keys 1–4 (which also choose the colour, as before). Only the user's own
highlights are read: an assistant's passages and glosses (D7b, D8) and a decision's key passages are not highlights
and are never touched.

`planInk` (`utils/highlighterRules.ts`, pure) reads the selection `[start, end)` in the projection, the ink, and the
highlights as they land (`resolveAnchors`). The colour seen at a point is the innermost highlight's, in the renderer's
own nesting (`byNesting`: the later start, then the earlier end, then the later highlight).

| The selection… | ink X | «Nessun colore» |
| --- | --- | --- |
| touches no highlight | a new highlight X | nothing |
| lies inside highlights, the innermost being X | the piece is taken out of every X highlight that holds it | the piece is taken out of every highlight it touches |
| lies inside highlights, the innermost another colour | the piece is recoloured X: cut out of that highlight, a new X highlight over it (none when the highlight drawn under it is already X); the whole highlight selected is recoloured in place (`PUT`) | as above |
| reaches out of the highlights it touches | a new highlight X, as before (overlapping) | the piece is taken out of every highlight it touches |

**The cut.** Offsets cannot change (`PUT` takes a colour and a note only), so cutting a piece out of a highlight is:
delete it, and create the parts outside the selection (`POST`), in the highlight's colour, each trimmed of whitespace at
its edges, a part of whitespace alone dropped. The highlight's `note` field, unused by the web, is copied to each part.
The user's notes are objects of their own, anchored by position: none is lost.

**What cannot be cut.** A highlight taken from the Forum carries its first author (`sourceSuggestionId`,
`originalAuthor`), which `POST` does not accept: recreating its parts would lose the attribution (gotcha 21). On such a
highlight the gesture acts on the whole: it is removed, or recoloured in place (`PUT` keeps it). The same for a highlight
saved before offsets existed (it has no offset to cut at). When the server lets an author pass through a cut (a `PUT`
of the offsets, or a `POST` that copies the author), these are cut too.

**One gesture, one «Annulla».** (Since §7: no notification, Ctrl+Z alone, the removals held until the next gesture;
and the rules above are §7's for the same colour and the others.)
`editHighlights` (store) takes a plan's removals, recolourings and new parts at once:

- removals go behind one notification with «Annulla» (`removeManyWithUndo`, the D7b bin's pattern that
  `removeHighlight` already follows: off the screen at once, `DELETE` sent when the notification closes, or as the page
  goes or is hidden) — after the new parts are saved: a page that goes before keeps the highlight whole on the server,
  and a part refused takes the whole gesture back;
- the new parts are sent at once (`POST`), and a recolouring at once (`PUT`, after the highlight's own creation when it
  is still on its way);
- «Annulla» puts the removed highlights back, deletes the new parts (after their creation answers, when it has not),
  and puts the old colour back (`PUT`); Ctrl+Z runs it as any «Annulla».
- Words: «Evidenziazione rimossa» (several highlights: «Evidenziazioni rimosse»), «Evidenziazione cambiata in verde».
  A new highlight keeps the reader's own toast («Testo evidenziato in giallo»); «Nessun colore» over plain text says
  nothing. The old «Questa occorrenza è già evidenziata» goes: the same words with the same colour now take it away.

«Fai tua» on a decision's key passage is not a gesture of the highlighter: it creates a highlight in the saved colour,
as before, whatever the ink.

## 4. Where

- The readers that use `SelectionPopup`: the article (`ArticleTabContent`), the decision (`DecisionReadingSurface`),
  the dossier's entry (`DossierItemReader`), Study Mode (`StudyModeContent`). Gymnasium's validation reader
  (`ArticleReadOnly`) is copy only and takes no highlight.
- The four bars that held the colour menu: `ReadingToolbar` (its phone row too), `DecisionReadingToolbar`,
  `DossierItemReader`'s actions, `StudyModeHeader`.
- **Gymnasium's lessons** (`LessonText`): the same button over the text, the same rules and the cut, «Nessun colore»;
  the floating «Evidenzia» and «Togli» go. A lesson's highlights are the session's work, kept in this tab
  (`sessionStorage`, `visualex.studia.percorsi.lavoro`) and never sent (spec 2026-10-23 §8): so a highlight now keeps
  its colour, `[start, end, colour]` (a saved one without colour reads as yellow). The lesson's highlights do not
  overlap: a colour paints over what it covers (`paintSpans`, pure), which draws the table above exactly. From the
  keyboard: Shift and the arrows select from the text (as before), H applies the ink; Enter on a highlight selects its
  words. No note tool in a lesson (lessons take no notes).

## 5. Accessibility and look

- Both halves of the button are reachable by Tab; Enter and Space press the left one; the arrow opens the menu with the
  keyboard (`MenuButton`). `aria-pressed` on the tool; Italian names; 44 px on a touch screen.
- Inchiostro's tokens only: the highlight tints and inks already declared (`--hl-*`), the toolbar toggles' pressed
  look (`toolbarToggleClass`). No new colour, no motion.
- The cursor is a hint; the pressed button is the state.

## 6. The second round: the note as a tool, the notes beside the text

Designed now, built in the second pull request.

- **The note tool**: a second split button beside the highlighter, its menu «Nota personale» (today's note) and
  «Glossa» (a discussion with colleagues, where the reader has them). On, each selection opens the editor of that note
  in the margin, not in a popover. The two tools exclude each other (`readingTool`).
- **Personal notes beside the text**, as a word processor's comments: `GlossMargin` generalised to the reader's own
  notes and to the readers that lack it (the article, Study Mode), each card at its passage's height; a click on the
  wavy passage focuses its card, a card hovered or focused shows its passage (the CSS Custom Highlight API); edited
  and removed from the card. On a phone and in narrow readers the cards go to a sheet from the bottom (`ui/Sheet`),
  44 px.
- **The block's sign without a popover**: on a wide reader its press focuses the block's first card; on a phone it
  opens the sheet. `BlockAnnotationsPopover` goes; a discussion opens from its card. The keyboard's way to remove a
  highlight that the popover gave (its bin) has to stay: the sheet lists the block's highlights on a phone, and the
  second round decides where a keyboard user on a computer removes one (the highlights' panel in the bar is the
  candidate).

## 7. Corrections after the test of #410 (the owner, 5 November 2026)

The test passed on the article, a decision, a dossier entry and Study Mode; three corrections before the merge.

- **Whole words, as a word processor.** A selection that cuts a word takes it whole: its start and end are widened to
  the word's edges (letters, digits and their marks; an elided «l'» is a word of its own). With Alt held while
  selecting, the piece exactly as selected. Every gesture alike — creating, taking away, recolouring, «Nessun colore»
  — in the readers, Study Mode's keys and a lesson. A note keeps the words as selected. Widened in the DOM
  (`utils/inkSelection.ts`), never in the projection, where a block's last word and the next block's first touch once
  the `\n` is gone: a word stops at a block or a line break. Alt is read from the press that made the selection while
  the selection stands as made; Enter on a lesson's highlight selects its words exactly. A selection made from the
  keyboard (Shift and the arrows) is taken as made, as a word processor takes it: a word at a time is Ctrl (Alt on a
  Mac) with Shift and the arrows, and a keyboard user keeps the exact piece.
- **No notification for highlights; Ctrl+Z (⌘Z) undoes.** Creating, taking away, cutting and recolouring say nothing
  on screen (the words are said to a screen reader). Ctrl+Z (⌘Z on a Mac), outside a field, takes back the last gesture
  with no time limit, while its text is on screen; one step, as the owner asked («al massimo devo poter fare cmd + z»).
  Without a notification closing, a gesture's removals are sent when the next gesture comes (its place taken), when
  the page is hidden or goes (`pagehide`, `visibilitychange`, as before; the key's undo goes with them) and at logout,
  before the token goes. Held until then, a highlight taken from the Forum and put back is the same row, its first
  author kept: no server change. The cost: another device sees the highlight until it is sent.
- **Notes keep their notification**, «Annulla» for five seconds, and Ctrl+Z (⌘Z) as its shortcut (L-36, already
  there); with a highlight's gesture also waiting, the key takes the newer first.
- **The same colour takes itself away; another is overwritten** (the owner, later the same day: «sovrascrive altri
  colori se presenti e non cancella il resto, se ripassa sopra lo stesso colore soltanto, cancella»). With the ink X,
  over X alone (spaces aside, the colour seen being the innermost's) → X taken away where the selection passes, from
  every highlight of it there; over anything else — plain words, another colour, a mix — → X over the whole selection,
  the other colours giving way where it passes, the rest of them kept. This replaces §3's «reaching out → a new
  highlight, overlapping»: the old rule stacked highlights of one colour, which a later cut cut each on its own, making
  identical parts — the duplicates in the owner's local database (four «te» at the same offsets). Two highlights of
  one colour never overlap now: what a gesture lays down in a colour is joined to the highlights of that colour it
  overlaps or meets across spaces alone (so the words beside a highlight lengthen it). A highlight that is never cut
  (from the Forum) is not joined either. The lessons follow the same rules in their form (`paintSpans`).
- **No duplicates** (the owner's fifth point: «te» saved four times at the same offsets). Where they came from: the old
  rule's stacked highlights of one colour, each cut on its own into identical parts (gone with the rule above); and a
  second gesture before the screen caught up — a key held down, whose repeats found the reader's highlights as the last
  render drew them, without the first. Now the rules read the store's highlights as they apply, a key held down
  highlights once, and the store makes no highlight identical to one it holds. The duplicates already saved go with
  the same colour passed over them (over X alone, X goes from every highlight of it there). A unique key on the
  server would be the last guard: a migration, the owners' to decide.
- As before: «Nessun colore» over words with no highlight does nothing and says nothing.

## Not in A4

The labels for MERL-T on the highlights (part B of the proposal), and the assistant's glosses without personal data.
