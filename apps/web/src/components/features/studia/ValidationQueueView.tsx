import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import type { Materia, Scheda } from '../../../types/studia';
import { FormSelect } from '../../ui/FormSelect';
import { Toast } from '../../ui/Toast';
import { ArticleReadOnly } from './ArticleReadOnly';
import { MATERIA_LABEL, anchorLabel, cardTitle, normaFromAnchor } from './studiaLabels';
import { useValidationQueue, type VoteOutcome } from './useValidationQueue';
import { VoteBar } from './VoteBar';

const STORAGE_KEY = 'visualex.studia.valida.materia';
const MEASURE = 'max-w-[60ch]';
const MATERIE = Object.keys(MATERIA_LABEL) as Materia[];

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

/** The subject the validator last chose; a missing, unreadable or unknown value is «all subjects». */
function rememberedMateria(): Materia | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MATERIE.find((materia) => materia === stored);
  } catch {
    return undefined;
  }
}

function rememberMateria(materia: Materia | undefined): void {
  try {
    if (materia) localStorage.setItem(STORAGE_KEY, materia);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or a full store: the choice lasts for this visit only.
  }
}

const OUTCOME_TOAST: Partial<Record<VoteOutcome, Exclude<ToastState, null>>> = {
  voted: { message: 'Voto registrato', type: 'success' },
  gone: { message: 'La scheda non è più in coda: passo alla prossima.', type: 'info' },
  already: { message: 'Hai già votato questa scheda: passo alla prossima.', type: 'info' },
  failed: { message: 'Non sono riuscito a registrare il voto. Riprova.', type: 'error' },
};

/**
 * The card under review, read like the law it rests on: the title as a source line, then the
 * question and the answer in the reader's serif, set apart by one rule. Everything is plain text.
 */
function CardBody({ card }: { card: Scheda }) {
  const anchors = [...card.ancore].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const others = anchors.slice(1);
  return (
    <article aria-label="Scheda da validare" className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm text-slate-500 dark:text-slate-400">{cardTitle(card)}</h3>
        <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-xl leading-[1.7] text-slate-900 dark:text-slate-50')}>{card.domanda}</p>
        <hr className={cn(MEASURE, 'my-4 border-slate-200 dark:border-slate-700')} />
        <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-lg leading-[1.7] text-slate-800 dark:text-slate-200')}>{card.risposta}</p>
      </div>
      {card.spiegazione && (
        <section>
          <h4 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Spiegazione</h4>
          <p className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-base leading-[1.7] text-slate-600 dark:text-slate-400')}>{card.spiegazione}</p>
        </section>
      )}
      {others.length > 0 && (
        <section>
          <h4 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Altre ancore</h4>
          <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {others.map((anchor) => (
              <li key={`${anchor.normaKey}|${anchor.articleId}`}>{anchorLabel(anchor) ?? anchor.urn}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/**
 * The article the card rests on: the primary anchor's, read from the address the anchor holds. When
 * the address cannot be turned back into an article, the citation stands alone with a short note.
 */
function AnchoredArticle({ card, showToast }: { card: Scheda; showToast: (message: string, type?: 'success' | 'error' | 'info') => void }) {
  const anchor = card.ancore.find((a) => a.isPrimary) ?? card.ancore[0];
  const urn = anchor?.urn;
  const norma = useMemo(() => (urn ? normaFromAnchor({ urn }) : null), [urn]);
  if (!anchor || !norma) {
    return (
      <div className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
        {anchor && <p className="break-words">{anchorLabel(anchor) ?? anchor.urn}</p>}
        <p className="text-slate-500 dark:text-slate-400">Il testo di questo articolo non si può aprire qui.</p>
      </div>
    );
  }
  return <ArticleReadOnly key={`${card.id}|${urn}`} norma={norma} showToast={showToast} />;
}

/**
 * «Da validare»: the proposed cards a validator may judge, one at a time, oldest first, with the
 * article the card rests on beside it (under it, collapsed, on a phone) and the three verdicts at
 * the bottom. The subject filter is remembered in the browser and starts the next visit.
 */
export function ValidationQueueView() {
  const desktop = useIsDesktop();
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  const { status, card, voting, vote, retry } = useValidationQueue(materia);
  const [toast, setToast] = useState<ToastState>(null);
  // The collapsed section belongs to a card: the next one starts closed.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => setToast({ message, type });

  const chooseMateria = (value: string) => {
    const next = MATERIE.find((m) => m === value);
    setMateria(next);
    rememberMateria(next);
  };

  const cast: Parameters<typeof VoteBar>[0]['onVote'] = async (giudizio, motivazione) => {
    const outcome = await vote(giudizio, motivazione);
    const message = OUTCOME_TOAST[outcome];
    if (message) setToast(message);
  };

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <h2 className="sr-only">Da validare</h2>
      <div className="max-w-xs">
        <FormSelect aria-label="Materia" value={materia ?? ''} onChange={(e) => chooseMateria(e.target.value)} className="min-h-[44px] md:min-h-0">
          <option value="">Tutte le materie</option>
          {MATERIE.map((m) => (
            <option key={m} value={m}>{MATERIA_LABEL[m]}</option>
          ))}
        </FormSelect>
      </div>

      {status === 'loading' && <p className="text-sm text-slate-500 dark:text-slate-400">Carico le schede…</p>}
      {status === 'empty' && <p className="py-8 text-sm text-slate-600 dark:text-slate-300">Nessuna scheda da validare in questa materia</p>}
      {status === 'forbidden' && (
        <div role="alert" className="space-y-1 py-8 text-sm text-slate-600 dark:text-slate-300">
          <p className="font-medium text-slate-800 dark:text-slate-100">Non sei più tra i validatori</p>
          <p>Se pensi sia un errore, chiedilo a un amministratore.</p>
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm text-red-600 dark:text-red-400">
          Non riesco a leggere le schede da validare.
          <button type="button" onClick={retry} className="min-h-[44px] rounded px-2 font-medium underline md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            Riprova
          </button>
        </div>
      )}

      {status === 'ready' && card && (
        <>
          <div className="md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-6">
            <div className="min-w-0">
              <CardBody card={card} />
              {!desktop && (
                <section className="mt-5 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <h4>
                    <button
                      type="button"
                      aria-expanded={openFor === card.id}
                      onClick={() => setOpenFor(openFor === card.id ? null : card.id)}
                      className="flex min-h-[44px] w-full items-center justify-between rounded text-left text-sm font-semibold text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      Testo dell’articolo
                      <ChevronDown size={16} aria-hidden className={cn('transition-transform', openFor === card.id && 'rotate-180')} />
                    </button>
                  </h4>
                  {openFor === card.id && <AnchoredArticle card={card} showToast={showToast} />}
                </section>
              )}
            </div>
            {desktop && (
              <div className="sticky top-0 max-h-screen min-w-0 overflow-y-auto pb-4">
                <AnchoredArticle card={card} showToast={showToast} />
              </div>
            )}
          </div>
          {/* Pinned to the bottom of the screen on a phone, where the thumb is; in the flow on a desktop. */}
          <div
            className={cn(
              'sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-50 px-4 py-3 md:static md:mx-0 md:border-t-0 md:bg-transparent md:px-0 dark:border-slate-800 dark:bg-slate-950 md:dark:bg-transparent',
              Z_INDEX.sticky,
            )}
          >
            <VoteBar cardId={card.id} busy={voting} onVote={(giudizio, motivazione) => void cast(giudizio, motivazione)} />
          </div>
        </>
      )}

      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        <Toast message={toast?.message ?? ''} type={toast?.type ?? 'success'} isVisible={toast !== null} onClose={() => setToast(null)} />
      </div>
    </section>
  );
}
