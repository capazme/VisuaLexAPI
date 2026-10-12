import { useCallback } from 'react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import type { DecisionReference, FoundDecision } from '../../../types/decisions';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import { DecisionAnswerBody } from './DecisionEntryView';

/**
 * A decision in its workspace tab, the old surface's until P6: a thin wrapper over
 * `DecisionEntryView`'s body (`DecisionAnswerBody`), which fetches and draws it. Once the decision
 * is found the store learns the tab's identity and label (`setDecisionTabIdentity`); the Cronologia
 * is told once per opening, the key kept on the tab (`historyRecordedKey`, persisted with it).
 */
export function DecisionTabView({ tabId, reference }: { tabId: string; reference: DecisionReference }) {
  const setIdentity = useAppStore((s) => s.setDecisionTabIdentity);
  const markRecorded = useAppStore((s) => s.markDecisionRecorded);

  const onFound = useCallback((answer: FoundDecision) => {
    setIdentity(tabId, answer.identita, formatDecisionShort({ ...answer.identita, sezione: answer.attributi.sezione }));
  }, [setIdentity, tabId]);
  const needsRecord = useCallback((key: string) => {
    const tab = appStore.getState().workspaceTabs.find((t) => t.id === tabId);
    return Boolean(tab) && tab?.historyRecordedKey !== key;
  }, [tabId]);
  const onRecorded = useCallback((key: string) => markRecorded(tabId, key), [markRecorded, tabId]);

  return (
    <DecisionAnswerBody
      reference={reference}
      hostId={tabId}
      focusId={tabId}
      onFound={onFound}
      needsRecord={needsRecord}
      onRecorded={onRecorded}
    />
  );
}
