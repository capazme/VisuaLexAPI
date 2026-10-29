import { useId } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { CONSENT_LEVELS } from '../consent/levels';
import { HUB_PRIMARY, HUB_TEXT } from './hubStyles';

// A level's summary inside a sentence: its words as the consent screen writes them, the first letter lowered.
const summary = (level: 'basic' | 'full') => {
  const words = CONSENT_LEVELS.find((meta) => meta.level === level)!.summary;
  return words.charAt(0).toLowerCase() + words.slice(1);
};

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
      {/* What each level collects in the consent screen's own words (`levels.ts`), never a shorter list; said as what
          it collects, not as what it unlocks. */}
      <p className="mt-2 max-w-prose text-sm text-slate-700 dark:text-slate-300">
        <strong className="font-medium text-slate-900 dark:text-slate-50">Che cosa raccoglie.</strong> Con il consenso
        base: {summary('basic')} Con il completo: {summary('full')} Puoi cambiarlo o revocarlo quando vuoi.
      </p>
      <button type="button" onClick={onChoose} className={`mt-4 ${HUB_PRIMARY}`}>
        Scegli il consenso
      </button>
    </section>
  );
}

/**
 * In place of «Attiva MERL-T» when no consent can be given here: a server without MERL-T, or without its notice
 * (`off`: the consent dialog has nothing to show), or a consent the server did not let us read (`unread`, with a
 * way to try again). Never a button that does nothing.
 */
export function ConsentUnavailable({ reason, onRetry }: { reason: 'off' | 'unread'; onRetry: () => void }) {
  return (
    <section
      data-testid="hub-consent-unavailable"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <ShieldOff size={18} aria-hidden className="shrink-0 text-slate-500 dark:text-slate-400" />
      <p className={`min-w-0 flex-1 ${HUB_TEXT}`}>
        {reason === 'off'
          ? 'MERL-T non è attivo su questo server: per ora non si può dare il consenso.'
          : 'Non è stato possibile leggere il tuo consenso a MERL-T.'}
      </p>
      {reason === 'unread' && (
        <button type="button" onClick={onRetry} className={HUB_PRIMARY}>
          Riprova
        </button>
      )}
    </section>
  );
}
