import { useState } from 'react';
import { Bot, Settings } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useMerltFeatures } from '../features/merlt/useMerltFeatures';
import { useConsent } from '../features/merlt/consent/useConsent';
import { ConsentDialog } from '../features/merlt/consent/ConsentDialog';
import { OpsTrainingButton } from '../features/merlt/ops/OpsTrainingButton';
import { OpsConfigPanel } from '../features/merlt/ops/OpsConfigPanel';
import { NerOpsCard } from '../features/merlt/ner/NerOpsCard';
import {
  useHubData,
  HubCard,
  QaCard,
  ValidateCard,
  GraphCard,
  ContribCard,
  ConsentCard,
  ProfileCard,
} from '../features/merlt/hub';
import type { MerltConsentLevel } from '../features/merlt/merltConsent';

const LEVEL_LABEL: Record<MerltConsentLevel, string> = {
  none: 'Nessuno',
  basic: 'Base',
  full: 'Completo',
};

export function MerltHubPage() {
  const features = useMerltFeatures();
  const { level } = useConsent();
  const [dialogOpen, setDialogOpen] = useState(false);

  const hub = useHubData(features.merltEnabled, {
    qaAskable: features.qaAskable,
    canValidate: features.canValidate,
    canContribute: features.canContribute,
    graphReadable: features.graphReadable,
  });

  if (!features.merltEnabled) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <Bot size={40} className="mb-3 text-slate-400" />
        <p className="text-slate-600 dark:text-slate-300">MERL-T non è disponibile in questa configurazione.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-6 dark:border-indigo-900 dark:bg-indigo-950/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900 dark:text-white">
              <Bot className="text-indigo-500" />
              Assistente
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              Il tuo centro per l’intelligenza giuridica MERL-T: fai domande, valida le proposte
              della community, esplora il grafo e contribuisci con i tuoi appunti.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/60 bg-white/70 px-4 py-2 dark:border-slate-700 dark:bg-slate-900/60">
            <span className="text-sm text-slate-500 dark:text-slate-400">Consenso</span>
            <span className="font-semibold text-slate-900 dark:text-white">{LEVEL_LABEL[level]}</span>
            <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
              Gestisci
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <QaCard qaAskable={features.qaAskable} lastQa={hub.lastQa} />

        <ValidateCard canValidate={features.canValidate} pendingCount={hub.pendingCount} />

        {/* Reading the graph is free (D2): visibility follows the feature flag. */}
        {features.graphEnabled && <GraphCard health={hub.health} />}

        <ContribCard canContribute={features.canContribute} lastContrib={hub.lastContrib} />

        <ConsentCard onManage={() => setDialogOpen(true)} />

        <ProfileCard profile={hub.profile} />

        {features.opsVisible && (
          <HubCard testId="hub-card-ops" icon={Settings} title="Ops (admin)">
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Avvia manualmente un ciclo di training RLCF sui feedback raccolti.
            </p>
            <OpsTrainingButton />
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
              <NerOpsCard />
            </div>
          </HubCard>
        )}

        {features.opsVisible && (
          <HubCard testId="hub-card-ops-config" icon={Settings} title="Regolazione motore (admin)">
            <OpsConfigPanel />
          </HubCard>
        )}
      </div>

      <ConsentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
