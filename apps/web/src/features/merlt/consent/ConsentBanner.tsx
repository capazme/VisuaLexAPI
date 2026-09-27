import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useConsent } from './useConsent';
import { ConsentDialog } from './ConsentDialog';
import { isMerltEnabled } from '../featureFlag';
import { subscribeMerltEvents, MERLT_EVENT_TYPES } from '../merltEventBus';

/**
 * The bus event types that actually result in data being sent to the BFF
 * (the 5 Slice 1 RLCF signals). The banner must trigger only on these — not on
 * passive UI events like scroll or text selection — so consent is requested
 * exactly at the point of collection.
 */
const TRACKED_EVENT_TYPES = new Set<string>([
  MERLT_EVENT_TYPES.articleViewed,
  MERLT_EVENT_TYPES.highlightCreated,
  MERLT_EVENT_TYPES.annotationCreated,
  MERLT_EVENT_TYPES.bookmarkCreated,
  MERLT_EVENT_TYPES.dossierItemAdded,
  MERLT_EVENT_TYPES.citationClicked,
  MERLT_EVENT_TYPES.forumLike,
  MERLT_EVENT_TYPES.forumDownload,
  MERLT_EVENT_TYPES.forumSuggestionAccepted,
  MERLT_EVENT_TYPES.forumSuggestionDeclined,
]);

/**
 * "Non ora" snooze (design §3.2): persisted for 30 days so the banner does not
 * nag on every session. The key stores the expiry timestamp (ms). Namespaced
 * like the other MERL-T local keys (`visualex.merlt.*`). Choosing any consent
 * level clears it, so a later revoke lets the banner surface again.
 */
const SNOOZE_KEY = 'visualex.merlt.consent-snooze';
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

function persistSnooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* localStorage unavailable — the in-memory dismiss still applies */
  }
}

function clearSnooze(): void {
  try {
    localStorage.removeItem(SNOOZE_KEY);
  } catch {
    /* localStorage unavailable — nothing to clear */
  }
}

/**
 * Non-blocking first-run consent prompt (Slice 2b). Mounted on the `global`
 * plugin slot so it survives route changes. It surfaces only when MERL-T is
 * enabled, the consent state is known (ready), no consent has been granted
 * yet, and a first trackable action has occurred — i.e. exactly at the point
 * where data would start being collected (GDPR-friendly), without interrupting
 * an unrelated workflow.
 */
export function ConsentBanner() {
  const { level, status } = useConsent();
  const [triggered, setTriggered] = useState(false);
  // Lazy initializer honours a persisted (unexpired) snooze on mount.
  const [dismissed, setDismissed] = useState(isSnoozed);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    // setState inside an event-driven subscriber callback (not synchronously in
    // the effect body) — allowed under react-hooks/set-state-in-effect.
    const unsubscribe = subscribeMerltEvents((event) => {
      if (TRACKED_EVENT_TYPES.has(event.interaction_type)) setTriggered(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    // External-state sync only (no setState): once a consent level is chosen
    // the snooze is moot — drop it so a future revoke re-enables the banner.
    if (level !== 'none') clearSnooze();
  }, [level]);

  const visible =
    isMerltEnabled() && status === 'ready' && level === 'none' && triggered && !dismissed;

  return (
    <>
      {visible && (
        <div
          data-testid="consent-banner"
          role="region"
          aria-label="Consenso MERL-T"
          className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-primary-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-primary-900 dark:bg-slate-900/95"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 shrink-0 text-primary-500" size={20} />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                MERL-T può imparare da come usi VisuaLex
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Con il tuo consenso il sistema migliora i suggerimenti giuridici. Nessun tuo
                contenuto viene condiviso senza una tua azione esplicita.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    persistSnooze();
                    setDismissed(true);
                  }}
                >
                  Non ora
                </Button>
                <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
                  Gestisci
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConsentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
