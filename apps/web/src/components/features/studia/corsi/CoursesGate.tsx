import { useEffect, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { loadAssistantFeatures } from '../../../../store/assistantProposals';
import { MUTED_TEXT } from '../progress/tokens';
import { useCoursesSwitch } from './coursesSwitch';

/**
 * «Percorsi»'s pages only while the switch `lingo_courses` is on (courses spec §10.10): the features are read again as a
 * page mounts (an administrator may have switched it meanwhile); until the first answer the page says it is loading,
 * and off it goes back to «Oggi», so with the switch off nothing of the courses appears.
 */
export function CoursesGate({ children }: { children: ReactNode }) {
  const state = useCoursesSwitch();
  useEffect(() => {
    void loadAssistantFeatures();
  }, []);
  if (state === 'off') return <Navigate to="/studia/ripasso" replace />;
  if (state === 'unknown') {
    return (
      <p role="status" className={`text-sm ${MUTED_TEXT}`}>
        Caricamento…
      </p>
    );
  }
  return <>{children}</>;
}
