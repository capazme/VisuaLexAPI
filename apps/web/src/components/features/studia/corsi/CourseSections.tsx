import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { CopyableCode } from '../../../../features/connections/CopyableCode';
import type { CompetenzaPagina, CorsoPagina, EsamePagina, Mancanze, ModuloPagina } from '../../../../types/corsi';
import { BLOCK_HEADING, FOCUS_RING, MUTED_TEXT, QUIET_BUTTON, SECONDARY_BUTTON, TILE } from '../progress/tokens';
import { MasteryChip, ModuleStateChip } from './CourseChips';
import { competenceNumbers, completeSentence, fromDay, missingLines, newExamSentence, onDay, thePercent } from './corsiLabels';

/** The course page's parts (courses spec §6.4), drawn from `GET /lingo/corsi/:id`. */

/** «In preparazione»: what is missing, the sentence for the assistant and «Il programma finisce qui» (Q11). */
export function PreparationPanel({ titolo, missing, onEndProgramme, busy }: {
  titolo: string;
  missing: Mancanze;
  /** Offered while fewer modules count than the programme planned, and at least one does. */
  onEndProgramme: (() => void) | null;
  busy: boolean;
}) {
  const lines = missingLines(missing);
  return (
    <section aria-labelledby="corso-preparazione" className={cn(TILE, 'grid grid-cols-1 gap-3 border-amber-300 p-5 dark:border-amber-800')}>
      <h3 id="corso-preparazione" className={BLOCK_HEADING}>
        In preparazione
      </h3>
      {lines.length > 0 && (
        <ul className="grid grid-cols-1 gap-1 text-sm text-slate-800 dark:text-slate-100">
          {lines.map((line) => (
            <li key={line} className="flex items-baseline gap-2">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-amber-500" />
              <span className="min-w-0 break-words">{line}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="max-w-[65ch] text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        Puoi già studiare i moduli che ci sono. Per completare il percorso chiedi al tuo assistente:
      </p>
      <div className="max-w-2xl">
        <CopyableCode code={completeSentence(titolo, missing)} label="la frase per completare il percorso" />
      </div>
      {onEndProgramme && (
        <div className="grid grid-cols-1 gap-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
          <p className="max-w-[65ch] text-sm text-slate-700 dark:text-slate-300">
            Non vuoi altri moduli? Chiudi il programma con{' '}
            {missing.moduli.contati === 1 ? 'l’unico modulo che c’è' : `i ${missing.moduli.contati} moduli che ci sono`}, così l’esame
            potrà aprirsi.
          </p>
          <button type="button" onClick={onEndProgramme} disabled={busy} className={cn(SECONDARY_BUTTON, 'justify-self-start disabled:opacity-60')}>
            Il programma finisce qui
          </button>
        </div>
      )}
    </section>
  );
}

export function CompetencesSection({ competenze }: { competenze: CompetenzaPagina[] }) {
  return (
    <section aria-labelledby="corso-competenze" className="grid grid-cols-1 gap-3">
      <h3 id="corso-competenze" className={BLOCK_HEADING}>
        Competenze
      </h3>
      <ul className={cn(TILE, 'grid grid-cols-1 divide-y divide-slate-200 dark:divide-slate-800')}>
        {competenze.map((c) => (
          <li key={c.codice} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 p-4">
            <span className="row-span-2 pt-0.5 font-mono text-sm font-semibold text-slate-500 dark:text-slate-400">{c.codice}</span>
            <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 flex-1 basis-64 break-words text-sm leading-relaxed text-slate-900 dark:text-slate-50">{c.testo}</span>
              <MasteryChip stato={c.stato} />
            </span>
            <span className={cn('break-words text-sm', MUTED_TEXT)}>{competenceNumbers(c)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface ModuleActions {
  /** A module never opened: to the trash. */
  onDelete: (modulo: ModuloPagina) => void;
  /** An opened module superseded by a live correction. */
  onWithdraw: (modulo: ModuloPagina) => void;
  /** The modules with a write out: their buttons wait. */
  busy: ReadonlySet<string>;
}

/** Whether a module can go to the trash: never opened, never withdrawn. */
const deletable = (m: ModuloPagina) => m.stato === 'da-iniziare' && !m.ritirato;
/** Whether «Ritira questo modulo» is offered: opened, superseded by a live correction, not yet withdrawn. */
const withdrawable = (m: ModuloPagina) => m.stato !== 'da-iniziare' && m.sostituitoDa !== null && !m.ritirato;

export function ModulesSection({ moduli, actions, headingRef }: { moduli: ModuloPagina[]; actions: ModuleActions; headingRef?: RefObject<HTMLHeadingElement | null> }) {
  const byId = new Map(moduli.map((m) => [m.id, m]));
  return (
    <section aria-labelledby="corso-moduli" className="grid grid-cols-1 gap-3">
      <h3 id="corso-moduli" ref={headingRef} tabIndex={-1} className={cn(BLOCK_HEADING, 'focus:outline-none')}>
        Moduli
      </h3>
      {moduli.length === 0 ? (
        <p className={cn('text-sm', MUTED_TEXT)}>Ancora nessun modulo: il tuo assistente li aggiunge uno alla volta.</p>
      ) : (
        <ol className={cn(TILE, 'grid grid-cols-1 divide-y divide-slate-200 dark:divide-slate-800')}>
          {moduli.map((m) => {
            const corrects = m.sostituisceId ? byId.get(m.sostituisceId) : undefined;
            const busy = actions.busy.has(m.id);
            return (
              <li key={m.id} className={cn('grid grid-cols-1 gap-2 p-4', m.ritirato && 'opacity-70')}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <h4 className="min-w-0 flex-1 basis-64 break-words text-base font-medium text-slate-900 dark:text-slate-50">
                    <span className={cn('mr-2 text-sm font-semibold', MUTED_TEXT)}>Modulo {m.ordine}</span>
                    {m.titolo}
                  </h4>
                  <ModuleStateChip stato={m.stato} ritirato={m.ritirato} />
                </div>
                <p className={cn('flex flex-wrap gap-x-3 gap-y-1 text-sm', MUTED_TEXT)}>
                  {m.competenze.length > 0 && <span>Competenze {m.competenze.join(', ')}</span>}
                  {m.minuti !== null && <span>circa {m.minuti} minuti</span>}
                  {m.creatoDa && <span className="break-words">creato da {m.creatoDa}</span>}
                  {m.sostituisceId && <span>correzione {corrects ? `del modulo ${corrects.ordine}` : 'di un modulo'}</span>}
                </p>
                {m.ritirato && <p className={cn('text-sm', MUTED_TEXT)}>Ritirato: le sue risposte non contano più, conta la correzione.</p>}
                {(deletable(m) || withdrawable(m)) && (
                  <div className="flex flex-wrap gap-2">
                    {deletable(m) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => actions.onDelete(m)}
                        aria-label={`Elimina il modulo ${m.ordine}, ${m.titolo}`}
                        className={cn(QUIET_BUTTON, 'mx-0 text-red-700 disabled:opacity-60 dark:text-red-300')}
                      >
                        Elimina
                      </button>
                    )}
                    {withdrawable(m) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => actions.onWithdraw(m)}
                        className={cn(SECONDARY_BUTTON, 'disabled:opacity-60')}
                      >
                        Ritira questo modulo
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** The final exam's state (§6.4); taking it comes with the web's pull request (d). */
export function ExamSection({ titolo, esame, inPreparazione }: { titolo: string; esame: EsamePagina | null; inPreparazione: boolean }) {
  return (
    <section aria-labelledby="corso-esame" className={cn(TILE, 'grid grid-cols-1 gap-2 p-5')}>
      <h3 id="corso-esame" className={BLOCK_HEADING}>
        Esame finale
      </h3>
      <ExamState titolo={titolo} esame={esame} inPreparazione={inPreparazione} />
    </section>
  );
}

function ExamState({ titolo, esame, inPreparazione }: { titolo: string; esame: EsamePagina | null; inPreparazione: boolean }) {
  const text = 'max-w-[65ch] text-sm leading-relaxed text-slate-700 dark:text-slate-300';
  if (esame === null) {
    return <p className={text}>{inPreparazione ? 'Il tuo assistente non ha ancora scritto l’esame.' : 'Nessun esame.'}</p>;
  }
  switch (esame.stato) {
    case 'bloccato':
      return <p className={text}>Si apre quando hai fatto tutti i moduli.</p>;
    case 'aperto':
      return <p className={text}>Aperto: hai fatto tutti i moduli.</p>;
    case 'superato':
      return (
        <p className={text}>
          Superato {onDay(esame.giorno)}, con {thePercent(esame.percentuale)}.
        </p>
      );
    case 'non-superato':
      return (
        <div className="grid grid-cols-1 gap-2">
          <p className={text}>
            Non superato ({esame.percentuale}%).
            {esame.sotto60.length > 0 && ` Sotto il 60%: ${esame.sotto60.join(', ')}; il ripasso ${esame.sotto60.length === 1 ? 'te la propone' : 'te le propone'}.`}
          </p>
          {esame.nuovoPossibile ? (
            <>
              <p className={cn(text, 'font-medium text-slate-900 dark:text-slate-50')}>Chiedi al tuo assistente un nuovo esame:</p>
              <div className="max-w-2xl">
                <CopyableCode code={newExamSentence(titolo, esame.sotto60)} label="la frase per un nuovo esame" />
              </div>
            </>
          ) : (
            <p className={text}>Un nuovo esame si può chiedere {fromDay(esame.nuovoDal)}.</p>
          )}
        </div>
      );
  }
}

/** The course's dossier, one link (§6.4, §7); its groups by module come with the dossier groups' spec. */
export function DossierLink({ dossier }: { dossier: CorsoPagina['dossier'] }) {
  if (!dossier) {
    return <p className={cn('text-sm', MUTED_TEXT)}>Il dossier del percorso non c’è più.</p>;
  }
  return (
    <Link
      to={`/dossier?dossier=${encodeURIComponent(dossier.id)}`}
      className={cn(SECONDARY_BUTTON, 'inline-flex max-w-full items-center gap-2 justify-self-start', FOCUS_RING)}
    >
      <FolderOpen aria-hidden size={16} className="shrink-0" />
      <span className="min-w-0 break-words">Dossier «{dossier.name}»</span>
    </Link>
  );
}
