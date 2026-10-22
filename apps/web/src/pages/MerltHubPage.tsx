import { useState } from 'react';
import { Bot, ChevronDown, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { PageFrame } from '../components/layout/PageFrame';
import { ASSISTANT_PAGE } from '../features/sections/pageNames';
import { cn } from '../lib/utils';
import { useMerltFeatures } from '../features/merlt/useMerltFeatures';
import { useConsent } from '../features/merlt/consent/useConsent';
import { ConsentDialog } from '../features/merlt/consent/ConsentDialog';
import { OpsTrainingButton } from '../features/merlt/ops/OpsTrainingButton';
import { OpsHygieneButton } from '../features/merlt/ops/OpsHygieneButton';
import { OpsConfigPanel } from '../features/merlt/ops/OpsConfigPanel';
import { NerOpsCard } from '../features/merlt/ner/NerOpsCard';
import {
  useHubData,
  HubCard,
  ConsentFirst,
  QaCard,
  ValidateCard,
  GraphCard,
  ContribCard,
  ConsentCard,
  ProfileCard,
} from '../features/merlt/hub';
import { HUB_LINK } from '../features/merlt/hub/hubStyles';
import type { MerltConsentLevel } from '../features/merlt/merltConsent';

const LEVEL_LABEL: Record<MerltConsentLevel, string> = {
  none: 'Nessuno',
  basic: 'Base',
  full: 'Completo',
};

/** The panels the row at the page's foot opens, one at a time. */
type FootPanel = 'consent' | 'profile';

export function MerltHubPage() {
  const features = useMerltFeatures();
  const { level, status: consentStatus } = useConsent();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [footPanel, setFootPanel] = useState<FootPanel | null>(null);

  const hub = useHubData(features.merltEnabled, {
    qaAskable: features.qaAskable,
    canValidate: features.canValidate,
    canContribute: features.canContribute,
    graphReadable: features.graphReadable,
  });

  if (!features.merltEnabled) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <Bot size={40} aria-hidden className="mb-3 text-slate-400" />
        <p className="text-slate-600 dark:text-slate-300">MERL-T non è disponibile in questa configurazione.</p>
      </div>
    );
  }

  const toggle = (panel: FootPanel) => setFootPanel((open) => (open === panel ? null : panel));

  return (
    <PageFrame
      title={ASSISTANT_PAGE}
      line="Il tuo centro per l’intelligenza giuridica MERL-T: fai domande, valida le proposte della community, esplora il grafo e contribuisci con i tuoi appunti."
      section="academia"
    >
      {/* Consent first (S7b): with none, what MERL-T does and collects comes before what it cannot do yet — once the
          server has said so: while it reads, the level is «none» for everyone. */}
      {level === 'none' && consentStatus === 'ready' && <ConsentFirst onChoose={() => setDialogOpen(true)} />}

      {/* Four cards of equal height, one action each; an action that needs more consent says so. */}
      <div className="grid gap-5 md:grid-cols-2">
        <QaCard qaAskable={features.qaAskable} lastQa={hub.lastQa} />

        <ValidateCard canValidate={features.canValidate} pendingCount={hub.pendingCount} />

        {/* Reading the graph is free (D2): visibility follows the feature flag. */}
        {features.graphEnabled && <GraphCard health={hub.health} />}

        <ContribCard canContribute={features.canContribute} lastContrib={hub.lastContrib} />

        {features.opsVisible && (
          <HubCard testId="hub-card-ops" icon={Settings} title="Ops (admin)">
            <p className="mb-3 text-sm text-slate-700 dark:text-slate-300">
              Avvia manualmente un ciclo di training RLCF sui feedback raccolti.
            </p>
            <OpsTrainingButton />
            <OpsHygieneButton />
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

      {/* The consent and the profile, in a row of links at the foot: each opens its panel under the row. */}
      <div className="border-t border-slate-200 pt-2 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-x-6">
          <button
            type="button"
            aria-expanded={footPanel === 'consent'}
            aria-controls="hub-foot-consent"
            onClick={() => toggle('consent')}
            className={HUB_LINK}
          >
            <ShieldCheck size={16} aria-hidden />
            Consenso e privacy
            <span className="font-normal text-slate-600 dark:text-slate-400">· {LEVEL_LABEL[level]}</span>
            <ChevronDown size={16} aria-hidden className={cn('transition-transform motion-reduce:transition-none', footPanel === 'consent' && 'rotate-180')} />
          </button>
          <button
            type="button"
            aria-expanded={footPanel === 'profile'}
            aria-controls="hub-foot-profile"
            onClick={() => toggle('profile')}
            className={HUB_LINK}
          >
            <Sparkles size={16} aria-hidden />
            Il tuo profilo
            <ChevronDown size={16} aria-hidden className={cn('transition-transform motion-reduce:transition-none', footPanel === 'profile' && 'rotate-180')} />
          </button>
        </div>
        {/* The panels' places stay in the page, so each button's `aria-controls` names an element. */}
        <div id="hub-foot-consent" hidden={footPanel !== 'consent'} className="mt-3 max-w-2xl">
          {footPanel === 'consent' && <ConsentCard onManage={() => setDialogOpen(true)} />}
        </div>
        <div id="hub-foot-profile" hidden={footPanel !== 'profile'} className="mt-3 max-w-2xl">
          {footPanel === 'profile' && <ProfileCard profile={hub.profile} />}
        </div>
      </div>

      <ConsentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </PageFrame>
  );
}
