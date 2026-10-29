/**
 * The words the reader sees for an assistant's gloss (D8): a note an application wrote on a passage of a dossier entry,
 * validated by the user. Every visible phrase that names one is here and nowhere else, because the word may change:
 * «glossa» is also the Forum's public discussion on a passage (`ArticleThread`), and the owners may choose another
 * word. Code and comments say `gloss` whatever the word shown.
 */
export const GLOSS_WORDS = {
  /** A heading or a label: «Glossa». */
  one: 'Glossa',
  /** «Glosse». */
  many: 'Glosse',
  /** On the sign, before the states: «1 glossa dell'IA», «2 glosse dell'IA». */
  count: (n: number) => `${n} ${n === 1 ? 'glossa' : 'glosse'} dell'IA`,
  /** The column beside the text and the popover's section. */
  column: "Glosse dell'IA",
  /** The notification of the bin, which offers «Annulla». */
  removed: 'Glossa rimossa',
  /** A bin refused by the server. */
  notRemoved: 'Glossa non rimossa',
  /** A move whose gloss went meanwhile (removed in another tab). */
  notMoved: 'Glossa non spostata: è stata rimossa altrove.',
  /** The bar that asks for the passage's new words. */
  moveTitle: 'Sposta la glossa',
  /** The box that edits the note. */
  noteLabel: 'Testo della glossa',
  /** The list of those whose words are no longer in the text. */
  lostTitle: "Glosse dell'IA non più nel testo",
  lostHelp: "Le parole su cui l'IA le aveva scritte non sono nel testo mostrato.",
  /** A block with glosses in the margin, in the popover of a computer's wide reader: the way to them. */
  goTo: (n: number) => (n === 1 ? 'Vai alla glossa a margine' : `Vai alle ${n} glosse a margine`),
} as const;
