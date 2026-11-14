/**
 * The in-memory state of a person, reset whenever a session ends (`forgetUserData` in `sessionEnd.ts`): the
 * store's user data, the caches of decisions, case law and cards, the consent read, Gymnasium's marks and the
 * assistant's proposals. Registered once, on import; `useAuth` imports it, so it is in place before any
 * request can end a session.
 */
import { appStore } from '../store/useAppStore';
import { resetAssistantProposals } from '../store/assistantProposals';
import { clearDecisionCache } from '../utils/decisionFetchCache';
import { clearDecisionSearchCache } from '../utils/decisionSearchCache';
import { clearEuCaseLawCache } from '../utils/euCaseLawCache';
import { clearArticleCardsCache } from '../utils/articleCardsCache';
import { clearRassegneCache } from '../components/features/rassegne/useRassegne';
import { clearConsentRead } from '../features/merlt/consent/consentRead';
import { forgetSeenProgress } from '../components/features/studia/progress/seenProgress';
import { forgetModuleSessions } from '../components/features/studia/corsi/moduleSteps';
import { onSessionEnd, onWorkRestored } from './sessionEnd';

export function resetUserState(): void {
  appStore.getState().clearUserData();
  clearDecisionCache();
  clearDecisionSearchCache();
  clearEuCaseLawCache();
  clearRassegneCache();
  clearArticleCardsCache();
  clearConsentRead();
  forgetSeenProgress();
  forgetModuleSessions();
  resetAssistantProposals();
}

onSessionEnd(resetUserState);

// Work given back to its owner at sign-in: the store reads its saved value again (and checks it, `sanitizePractices`).
onWorkRestored(() => {
  void appStore.persist.rehydrate();
});
