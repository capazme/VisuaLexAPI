import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Network, ScrollText, ShieldCheck, Sparkles, UploadCloud, MessageSquare, Settings } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useMerltFeatures } from '../features/merlt/useMerltFeatures';
import { useConsent } from '../features/merlt/consent/useConsent';
import { ConsentDialog } from '../features/merlt/consent/ConsentDialog';
import { OpsTrainingButton } from '../features/merlt/ops/OpsTrainingButton';
import { MyContributionsCard } from '../features/merlt/contrib/MyContributionsCard';
import { fetchMerltProfile, type MerltProfile } from '../services/merltService';
import type { MerltConsentLevel } from '../features/merlt/merltConsent';

const LEVEL_LABEL: Record<MerltConsentLevel, string> = {
  none: 'Nessuno',
  basic: 'Base',
  full: 'Completo',
};

type ProfileState =
  | { status: 'loading' }
  | { status: 'success'; data: MerltProfile }
  | { status: 'error' };

function HubCard({
  testId,
  icon: Icon,
  title,
  children,
}: {
  testId: string;
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <Icon size={18} className="text-primary-500" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export function MerltHubPage() {
  const features = useMerltFeatures();
  const { level, consent } = useConsent();
  const [profile, setProfile] = useState<ProfileState>({ status: 'loading' });
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!features.merltEnabled) return;
    let cancelled = false;
    fetchMerltProfile()
      .then((data) => {
        if (!cancelled) setProfile({ status: 'success', data });
      })
      .catch(() => {
        if (!cancelled) setProfile({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [features.merltEnabled]);

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
              MERL-T
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              Il tuo centro per l’intelligenza giuridica MERL-T: gestisci il consenso, esplora il
              grafo, e (presto) contribuisci con i tuoi appunti.
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

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <HubCard testId="hub-card-consent" icon={ShieldCheck} title="Consenso & Privacy">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Livello attuale: <strong>{LEVEL_LABEL[level]}</strong>.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {level === 'none'
              ? 'MERL-T non raccoglie nulla dalla tua attività.'
              : level === 'basic'
                ? 'Segnali d’uso e consultazione del grafo abilitati. Nessun contenuto condiviso.'
                : 'Contribuzione e validazione RLCF abilitate, con attribuzione a te.'}
          </p>
          {consent?.lastAuditAt && (
            <p className="mt-2 text-xs text-slate-400">
              Ultima modifica: {new Date(consent.lastAuditAt).toLocaleString('it-IT')}
            </p>
          )}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
              Gestisci consenso
            </Button>
          </div>
        </HubCard>

        <HubCard testId="hub-card-profile" icon={Sparkles} title="Profilo & Authority">
          {profile.status === 'loading' && (
            <p className="text-sm text-slate-400">Caricamento profilo…</p>
          )}
          {profile.status === 'error' && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Dati di authority non disponibili al momento.
            </p>
          )}
          {profile.status === 'success' && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Authority</dt>
                <dd className="font-semibold text-slate-900 dark:text-white">
                  {profile.data.authorityScore.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Contributi</dt>
                <dd className="font-semibold text-slate-900 dark:text-white">
                  {profile.data.totalContributions}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500 dark:text-slate-400">Qualifica</dt>
                <dd className="font-semibold text-slate-900 dark:text-white">
                  {profile.data.baselineQual}
                </dd>
              </div>
            </dl>
          )}
        </HubCard>

        {features.graphReadable && (
          <HubCard testId="hub-card-graph" icon={Network} title="Grafo giuridico">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Esplora le relazioni tra norme, principi e concetti.
            </p>
            <div className="mt-3">
              <Link to="/grafo">
                <Button variant="primary" size="sm">
                  Apri il grafo
                </Button>
              </Link>
            </div>
          </HubCard>
        )}

        <HubCard testId="hub-card-contrib" icon={UploadCloud} title="Apprendi dai miei appunti">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Carica i tuoi appunti per proporre nodi al grafo (RLCF).
          </p>
          <div className="mt-3">
            {features.canContribute ? (
              <Link to="/merlt/contribuisci">
                <Button variant="primary" size="sm">
                  Apri
                </Button>
              </Link>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Richiede consenso <strong>Completo</strong>.
              </p>
            )}
          </div>
          {features.canContribute && (
            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                I miei contributi recenti
              </p>
              <MyContributionsCard />
            </div>
          )}
        </HubCard>

        <HubCard testId="hub-card-validate" icon={ScrollText} title="Validazione community">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Vota le proposte di nodi/relazioni in attesa (RLCF).
          </p>
          <div className="mt-3">
            {features.canValidate ? (
              <Link to="/merlt/valida">
                <Button variant="primary" size="sm">
                  Apri
                </Button>
              </Link>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Richiede consenso <strong>Completo</strong>.
              </p>
            )}
          </div>
        </HubCard>

        <HubCard testId="hub-card-qa" icon={MessageSquare} title="Q&A esperti">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Domande giuridiche al sistema multi-expert, con fonti e provenienza sempre visibili.
          </p>
          <div className="mt-3">
            {features.canContribute ? (
              <Link to="/merlt/chiedi">
                <Button variant="primary" size="sm">
                  Apri
                </Button>
              </Link>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Richiede consenso <strong>Completo</strong>.
              </p>
            )}
          </div>
        </HubCard>

        {features.opsVisible && (
          <HubCard testId="hub-card-ops" icon={Settings} title="Ops (admin)">
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Avvia manualmente un ciclo di training RLCF sui feedback raccolti.
            </p>
            <OpsTrainingButton />
          </HubCard>
        )}
      </div>

      <ConsentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
