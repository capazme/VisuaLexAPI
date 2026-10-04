import type { ClipboardEvent } from 'react';
import type { DecisionText } from '../../../types/decisions';
import { decisionClipboardText, decisionParagraphs } from '../../../utils/decisionText';

const BLOCKS: Array<[keyof DecisionText, string]> = [
  ['epigrafe', 'Epigrafe'],
  ['motivazione', 'Motivazione'],
  ['dispositivo', 'Dispositivo'],
];

export interface DecisionTextViewProps {
  testo: DecisionText;
}

/** A copy of a passage that lies wholly inside the text writes the passage as it reads: the space
 *  between two lines is CSS, which the browser's own copy leaves out («ordinanzadel»). A selection
 *  that reaches outside the text, or none, is left to the browser. Nothing in the DOM changes (S6). */
function copyAsRead(event: ClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
  const text = decisionClipboardText(range.cloneContents());
  if (!text) return;
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
}

/** The decision as received: blocks as the reader divides them, one span per line. The space
 *  between two lines and each block's label come from CSS (index.css, "Court decisions"). An
 *  epigrafe without a motivazione holds the reasoning too, its start unmarked (the reader splits
 *  one only at a line beginning «Ritenuto» or «Considerato»: corte_cost.split_epigrafe), so it
 *  is labelled «Testo», never «Epigrafe» (decided by the owner on 2026-10-04). */
export function DecisionTextView({ testo }: DecisionTextViewProps) {
  return (
    <div className="vlx-art vlx-decision" onCopy={copyAsRead}>
      {BLOCKS.map(([key, name]) => {
        const text = testo[key];
        if (!text) return null;
        const label = key === 'epigrafe' && !testo.motivazione ? 'Testo' : name;
        return (
          <section key={key} className="vlx-dec-block" data-label={label} aria-label={label}>
            {decisionParagraphs(text).map((lines, p) => (
              <p key={p} className="vlx-dec-para">
                {lines.map((line, l) => (
                  <span key={l} className="vlx-dec-line">{line}</span>
                ))}
              </p>
            ))}
          </section>
        );
      })}
    </div>
  );
}
