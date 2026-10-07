// apps/web/src/components/features/decisions/DecisionAddress.tsx
import { useEffect } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { parseDecisionPath } from '../../../utils/decisionLinks';

/** `/sentenze/…` opens the search space with the decision's tab (design 2026-10-05 §3): the
 *  address stays the contract LibreLex and the Massimario's links build, the page is the tab.
 *  `/sentenze` alone, or an address that does not parse, opens the palette instead. */
export function DecisionAddress() {
  const params = useParams<{ corte?: string; numero?: string; anno?: string }>();
  const [search] = useSearchParams();
  const requestOpenDecision = useAppStore((s) => s.requestOpenDecision);
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);
  const pushError = useAppStore((s) => s.pushSyncError);
  const parsed = params.corte ? parseDecisionPath(params, search) : null;
  useEffect(() => {
    if (parsed?.ok) requestOpenDecision(parsed.reference);
    else {
      // the app's transient error toast (SyncErrorToast, mounted for the whole layout)
      if (parsed) pushError(`L'indirizzo non indica una sentenza leggibile: ${Object.values(parsed.errors).map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join('; ')}.`);
      openCommandPalette();
    }
    // the address is read once, as the route mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The navigation runs before this effect; SearchPanel drains the request whenever it changes.
  return <Navigate to="/" replace />;
}
