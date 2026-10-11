import { useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { studiaService } from '../../../services/studiaService';
import { formatDateForDisplay, todayInRome } from '../../../utils/dateUtils';
import { ClaudeMark } from '../../ui/ClaudeMark';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import type { AncoraScheda, RilievoValidatore, Scheda, TestoDaAccettare } from '../../../types/studia';
import { AcceptTextDialog } from './AcceptTextDialog';
import { StateChip } from './StateChip';
import { MATERIA_LABEL, TIPO_LABEL, anchorLabel } from './studiaLabels';

export interface CardDetailProps {
  card: Scheda;
  /** A phone shows the detail alone: «Indietro» returns to the list. */
  onBack?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Opens the anchor's article in the reader. */
  onOpenAnchor: (anchor: AncoraScheda) => void;
  /**
   * Proposing or withdrawing ended, well or not: the words to show, and whether they are good news.
   * The caller reads its lists again; the card is the caller's to refresh.
   */
  onChanged: (message: string, type: 'success' | 'error') => void;
  /** The validators' remarks could not be read: the section says so, with a way to try again. */
  rilieviFailed?: boolean;
  onRetryRilievi?: () => void;
}

const RILIEVO_LABEL: Record<RilievoValidatore['giudizio'], string> = {
  MIGLIORABILE: 'Migliorabile',
  ERRATA: 'Errata',
};

const statusOf = (error: unknown): number | undefined => (error as { status?: number } | null)?.status;

function proposeFailure(error: unknown): string {
  const status = statusOf(error);
  if (status === 404) return 'La scheda non c’è più. Ho aggiornato l’elenco.';
  if (status === 409) return 'Questa scheda non è più una bozza. Ho aggiornato l’elenco.';
  return 'Non sono riuscito a proporre la scheda. Riprova.';
}

function withdrawFailure(error: unknown): string {
  const status = statusOf(error);
  if (status === 404) return 'La scheda non c’è più. Ho aggiornato l’elenco.';
  if (status === 409) return 'Questa scheda non si può più ritirare. Ho aggiornato l’elenco.';
  return 'Non sono riuscito a ritirare la proposta. Riprova.';
}

const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors md:min-h-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const MEASURE = 'max-w-[60ch]';

/**
 * A card, read like the law it rests on: the article it rests on as a source line, then the
 * question and the answer in the reader's serif, set apart by one rule. Question, answer and
 * explanation are plain text, left to React as text nodes.
 *
 * A draft may be edited, proposed to the community and deleted, an archived card deleted; a
 * proposed card may only be withdrawn (it goes back to a draft); a validated or «da rivedere» card
 * is kept (spec D5, D6). Proposing asks the user to accept the server's current notice first.
 */
export function CardDetail({ card, onBack, onEdit, onDelete, onOpenAnchor, onChanged, rilieviFailed = false, onRetryRilievi }: CardDetailProps) {
  const canEdit = card.stato === 'BOZZA_PERSONALE';
  const canDelete = canEdit || card.stato === 'ARCHIVIATA';
  const canPropose = card.stato === 'BOZZA_PERSONALE';
  const canWithdraw = card.stato === 'PROPOSTA_COMMUNITY';
  // The notice belongs to the card it was asked for: another card selected never inherits it.
  const [asked, setAsked] = useState<{ cardId: string; text: TestoDaAccettare } | null>(null);
  const notice = asked && asked.cardId === card.id ? asked.text : null;
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [pending, setPending] = useState(false);
  // A second click before the first answer (the confirm button stays through the dialog's exit
  // animation) must not send a second request: state would still read idle in the same tick.
  const inFlight = useRef(false);

  // First without a notice accepted: the server answers the card, or the notice to accept (and again,
  // with a newer one, if an administrator saved a version meanwhile).
  const propose = async (acceptedTextId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const outcome = acceptedTextId ? await studiaService.propose(card.id, acceptedTextId) : await studiaService.propose(card.id);
      if ('richiedeTesto' in outcome) {
        setAsked({ cardId: card.id, text: outcome.richiedeTesto });
        return;
      }
      setAsked(null);
      onChanged('Scheda proposta alla comunità', 'success');
    } catch (error) {
      setAsked(null);
      onChanged(proposeFailure(error), 'error');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const withdraw = async () => {
    setConfirmWithdraw(false);
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await studiaService.withdraw(card.id);
      onChanged('Proposta ritirata: la scheda è di nuovo una bozza', 'success');
    } catch (error) {
      onChanged(withdrawFailure(error), 'error');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  // The primary anchor first; one whose address names no article cannot be opened.
  const anchors = [...card.ancore].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).filter((a) => anchorLabel(a));
  const [source, ...others] = anchors;

  return (
    <article aria-label="Scheda" className="space-y-5">
      <div className="flex items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className={cn(BUTTON, 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
            <ArrowLeft size={16} aria-hidden className="mr-1.5" />
            Indietro
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <button type="button" onClick={onEdit} className={cn(BUTTON, 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800')}>
              Modifica
            </button>
          )}
          {canPropose && (
            <button type="button" onClick={() => void propose()} disabled={pending} className={cn(BUTTON, 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60')}>
              Proponi alla comunità
            </button>
          )}
          {canWithdraw && (
            <button type="button" onClick={() => setConfirmWithdraw(true)} disabled={pending} className={cn(BUTTON, 'border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800')}>
              Ritira
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={onDelete} className={cn(BUTTON, 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20')}>
              Elimina
            </button>
          )}
        </div>
      </div>

      <div>
        {source && (
          <button
            type="button"
            onClick={() => onOpenAnchor(source)}
            title="Apri l’articolo nel lettore"
            className="mb-2 min-h-[44px] rounded text-left text-sm text-slate-500 hover:text-primary-700 hover:underline md:min-h-0 dark:text-slate-400 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {anchorLabel(source)}
          </button>
        )}
        <h3 className={cn(MEASURE, 'whitespace-pre-line break-words text-left font-serif text-xl leading-[1.7] text-slate-900 dark:text-slate-50')}>{card.domanda}</h3>
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
          <ul>
            {others.map((anchor) => (
              <li key={`${anchor.normaKey}|${anchor.articleId}`}>
                <button
                  type="button"
                  onClick={() => onOpenAnchor(anchor)}
                  title="Apri l’articolo nel lettore"
                  className="min-h-[44px] rounded text-left text-sm text-slate-600 hover:text-primary-700 hover:underline md:min-h-0 md:py-1 dark:text-slate-300 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {anchorLabel(anchor)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rilieviFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <p>Non ho potuto leggere i rilievi dei validatori.</p>
          <button type="button" onClick={onRetryRilievi} className={cn(BUTTON, 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800')}>
            Riprova
          </button>
        </div>
      )}

      {card.rilievi && card.rilievi.length > 0 && (
        <section aria-labelledby={`rilievi-${card.id}`}>
          <h4 id={`rilievi-${card.id}`} className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Rilievi dei validatori</h4>
          <ul className="space-y-3">
            {card.rilievi.map((rilievo, index) => (
              <li key={index} className={MEASURE}>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{RILIEVO_LABEL[rilievo.giudizio]}</span>
                  {' · '}
                  <time dateTime={rilievo.createdAt}>{formatDateForDisplay(todayInRome(new Date(rilievo.createdAt)))}</time>
                </p>
                <p className="whitespace-pre-line break-words text-sm text-slate-700 dark:text-slate-300">{rilievo.motivazione}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>{MATERIA_LABEL[card.materia]} · {card.istituto} · {TIPO_LABEL[card.tipo]}</span>
        <StateChip stato={card.stato} />
        {typeof card.approvazioni === 'number' && card.stato === 'PROPOSTA_COMMUNITY' && <span>Approvazioni: {card.approvazioni}</span>}
        {typeof card.approvazioni === 'number' && card.stato === 'VALIDATA' && <span>Validata da {card.approvazioni}</span>}
        <ClaudeMark createdBy={card.origine} />
      </div>

      {notice && <AcceptTextDialog text={notice} busy={pending} onAccept={(textId) => void propose(textId)} onCancel={() => setAsked(null)} />}
      <ConfirmDialog
        open={confirmWithdraw}
        variant="danger"
        title="Ritirare la proposta?"
        message="La scheda torna una tua bozza; i voti ricevuti si perdono."
        confirmLabel="Ritira"
        onConfirm={() => void withdraw()}
        onCancel={() => setConfirmWithdraw(false)}
      />
    </article>
  );
}
