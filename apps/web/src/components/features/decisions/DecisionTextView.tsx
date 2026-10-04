import type { DecisionText } from '../../../types/decisions';
import { decisionParagraphs } from '../../../utils/decisionText';

const BLOCKS: Array<[keyof DecisionText, string]> = [
  ['epigrafe', 'Epigrafe'],
  ['motivazione', 'Motivazione'],
  ['dispositivo', 'Dispositivo'],
];

export interface DecisionTextViewProps {
  testo: DecisionText;
}

/** The decision as received: blocks as the reader divides them, one span per line. The space
 *  between two lines and each block's label come from CSS (index.css, "Court decisions"). An
 *  epigrafe without a motivazione holds the reasoning too, its start unmarked (the reader splits
 *  one only at a line beginning «Ritenuto» or «Considerato»: corte_cost.split_epigrafe), so it
 *  is labelled «Testo», never «Epigrafe» (decided by the owner on 2026-10-04). */
export function DecisionTextView({ testo }: DecisionTextViewProps) {
  return (
    <div className="vlx-art vlx-decision">
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
