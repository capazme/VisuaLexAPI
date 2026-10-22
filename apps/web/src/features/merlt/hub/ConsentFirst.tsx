import { useId } from 'react';
import { ShieldCheck } from 'lucide-react';
import { CONSENT_LEVELS } from '../consent/levels';
import { HUB_PRIMARY } from './hubStyles';

const summary = (level: 'basic' | 'full') => CONSENT_LEVELS.find((meta) => meta.level === level)!.summary;

/**
 * The hub's first block when the consent is «Nessuno» (S7b, consent first): what MERL-T does, what it collects at each
 * level (the words of the consent screen's levels, `consent/levels.ts`), and the one way on — the same dialog as the
 * row at the page's foot and Impostazioni. Without it, a user with no consent met mostly what they could not do.
 */
export function ConsentFirst({ onChoose }: { onChoose: () => void }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid="hub-consent-first"
      className="rounded-xl border border-primary-200 bg-primary-50/60 p-5 md:p-6 dark:border-primary-900/60 dark:bg-primary-950/30"
    >
      <h2 id={headingId} className="flex items-center gap-2 font-serif text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
        <ShieldCheck size={20} aria-hidden className="shrink-0 text-primary-600 dark:text-primary-400" />
        Attiva MERL-T
      </h2>
      <p className="mt-2 max-w-prose text-sm text-slate-800 dark:text-slate-200">
        MERL-T è l’intelligenza giuridica di VisuaLex: risponde alle tue domande sul grafo delle norme e impara dai
        giudizi di chi lo usa. Il grafo lo puoi leggere sempre; per chiedere e per insegnare serve il tuo consenso.
      </p>
      {/* What each level collects in the consent screen's own words (`levels.ts`), never a shorter list. */}
      <p className="mt-2 max-w-prose text-sm text-slate-700 dark:text-slate-300">
        <strong className="font-medium text-slate-900 dark:text-slate-50">Base</strong>: {summary('basic')}{' '}
        <strong className="font-medium text-slate-900 dark:text-slate-50">Completo</strong>: {summary('full')} Puoi
        cambiarlo o revocarlo quando vuoi.
      </p>
      <button type="button" onClick={onChoose} className={`mt-4 ${HUB_PRIMARY}`}>
        Scegli il consenso
      </button>
    </section>
  );
}
