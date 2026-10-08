import { useMemo, useRef } from 'react';
import { ArticleDiscussionPanel } from '../search/ArticleDiscussionPanel';
import { DiscussionButton } from '../search/DiscussionButton';
import { useDiscussionWiring } from '../../../hooks/useDiscussionWiring';
import { decisionKey, formatDecisionShort } from '../../../utils/decisionLinks';
import type { DecisionAttributes, DecisionIdentity } from '../../../types/decisions';

/**
 * A decision found without its text still takes general discussions (spec §8.7 gates them on the
 * identity, not on the text): the button and the panel, with no «Discuti», no passages and no
 * signs. No text hash is recorded (there is no text to fingerprint), and any passage discussion
 * made while the text was there is listed with its quotation withheld, as no passage can be located.
 */
export function DecisionDiscussionsWithoutText({ identity, attributi }: { identity: DecisionIdentity; attributi: DecisionAttributes }) {
  const key = decisionKey(identity);
  const label = formatDecisionShort({ ...identity, sezione: attributi.sezione });
  const anchor = useMemo(() => ({ normaKey: key, articleId: '', articleLabel: label }), [key, label]);
  const contentRef = useRef<HTMLElement>(null);
  const discussion = useDiscussionWiring({
    anchor, text: '', plain: '', enabled: false, contentRef, onInvalidSelection: () => {},
  });
  return (
    <div className="flex justify-end">
      <DiscussionButton isOpen={discussion.open} onToggle={discussion.toggle} name="Discussioni sulla decisione" />
      <ArticleDiscussionPanel
        anchor={anchor}
        label={label}
        heading="Discussioni sulla decisione"
        textChangedNotice="Il testo della decisione è cambiato da quando è stata aperta questa discussione."
        withholdDetachedPassage
        passageTextAvailable={false}
        {...discussion.panelProps}
        textHash={null}
      />
    </div>
  );
}
