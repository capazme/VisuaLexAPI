import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ListChecks, Lock } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi, TappaIstituto } from '../../../../types/studia';
import { BookMark } from '../../../ui/BookMark';
import { MATERIA_LABEL } from '../studiaLabels';
import { dueLabel, instituteSessionPath, orderInstitutes } from './today';
import { BLOCK_HEADING, FOCUS_RING, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK, QUIET_BUTTON, SECONDARY_BUTTON, TILE, SUBJECT_ART, subjectHue } from './tokens';
import type { PercorsoState } from './usePercorso';
import { Illustration } from '../../../ui/Illustration';
import { CourseTrail } from '../corsi/CourseTrail';
import { LESSON_MIN_CARDS, lessonPath } from '../lezione/lessonPaths';

/** The stops drawn before «Mostra tutti»: a subject may hold hundreds of institutes. */
export const PATH_STOPS_SHOWN = 6;

const subjectPath = (materia: Materia) => `/learn/ripasso/sessione?materia=${materia}`;

type StopKind = 'due' | 'learning' | 'done' | 'new';

/**
 * What a stop is, from its counts: cards due today first; else studied and not yet consolidated; else all consolidated;
 * else only new cards. The order of the road is the server's (`orderInstitutes`: the cards due, then the name): there
 * is no curriculum behind the institutes, so the road shows what is on today, not a progression it does not have.
 */
function kindOf(stop: TappaIstituto): StopKind {
  if (stop.dovute > 0) return 'due';
  if (stop.apprendimento > 0) return 'learning';
  if (stop.consolidate > 0 && stop.nuove === 0) return 'done';
  return 'new';
}

/** A stop's line under its name: only the states it has, «3 nuove · 2 consolidate» (no row of zeros). */
function stopLine(stop: TappaIstituto): string {
  const parts = [
    stop.dovute > 0 && dueLabel(stop.dovute).toLowerCase(),
    stop.nuove > 0 && (stop.nuove === 1 ? '1 nuova' : `${stop.nuove} nuove`),
    stop.apprendimento > 0 && `${stop.apprendimento} in apprendimento`,
    stop.consolidate > 0 && (stop.consolidate === 1 ? '1 consolidata' : `${stop.consolidate} consolidate`),
  ].filter(Boolean);
  return parts.join(' · ');
}

/** The stop's node, 44 px: the cards due in ink, a ring for what is being learnt, a check for what is consolidated. */
function Node({ kind, due }: { kind: StopKind; due: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums',
        kind === 'due' && cn(INK_BG, ON_INK, 'shadow-[0_3px_0_var(--color-primary-950)] dark:shadow-[0_3px_0_var(--color-primary-500)]'),
        kind === 'learning' && cn('border-2 bg-card', INK_BORDER, INK_TEXT),
        kind === 'done' && 'bg-ink-300 text-slate-900 dark:bg-ink-700 dark:text-slate-50',
        kind === 'new' && 'border-2 border-dashed border-slate-400 bg-card text-slate-600 dark:border-slate-600 dark:text-slate-300',
      )}
    >
      {kind === 'due' ? due : kind === 'done' ? <Check size={18} strokeWidth={2.5} /> : null}
    </span>
  );
}

/** One subject on the road: its band (the subject, its counts, «Ripassa») and its institutes as stops joined by a line. */
function Unit({ materia, stops, counts, here }: { materia: Materia; stops: TappaIstituto[]; counts: Progressi['materie'][number] | undefined; here: string | null }) {
  const navigate = useNavigate();
  // «Sei qui» is never hidden behind «Mostra tutti»: a unit whose stop is past the first ones opens whole.
  const [all, setAll] = useState(() => here !== null && stops.findIndex((stop) => stop.istituto === here) >= PATH_STOPS_SHOWN);
  const label = MATERIA_LABEL[materia];
  const due = stops.reduce((sum, stop) => sum + stop.dovute, 0);
  const cards = counts ? counts.nuove + counts.apprendimento + counts.consolidate : stops.reduce((sum, s) => sum + s.nuove + s.apprendimento + s.consolidate, 0);
  const shown = all ? stops : stops.slice(0, PATH_STOPS_SHOWN);
  const headingId = `percorso-${materia}`;

  return (
    <section aria-labelledby={headingId} className={cn(TILE, 'overflow-hidden')}>
      {/* Tighter under `sm` (LC62b): on a 390 px phone the road was 1,200 px tall; the nodes stay 44 px. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-3">
        {/* LC35: the subject's emblem, an engraving; its colour stays on the dot by the name. */}
        <Illustration name={SUBJECT_ART[materia]} className="h-9 w-9 sm:h-12 sm:w-12" />
        <div className="min-w-0">
          <h3 id={headingId} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-50">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subjectHue(materia) }} />
            {label}
          </h3>
          <p className={cn('mt-0.5 text-sm tabular-nums', MUTED_TEXT)}>
            {cards === 1 ? '1 scheda' : `${cards} schede`} · {stops.length === 1 ? '1 istituto' : `${stops.length} istituti`}
            {due > 0 && ` · ${dueLabel(due).toLowerCase()}`}
          </p>
        </div>
        </div>
        <button type="button" onClick={() => navigate(subjectPath(materia))} className={cn(SECONDARY_BUTTON, 'shrink-0')}>
          Ripassa<span className="sr-only"> {label}</span>
        </button>
      </header>
      <LessonNode materia={materia} label={label} cards={cards} />
      <ol aria-label={`Istituti di ${label}`} className="relative px-4 py-2 sm:px-5 sm:py-4">
        {/* The road: one line under the nodes, from the first to the last drawn. */}
        {shown.length > 1 && <span aria-hidden className="absolute bottom-9 left-[38px] top-9 w-0.5 bg-slate-200 sm:left-[42px] dark:bg-slate-800" />}
        {shown.map((stop, index) => {
          const kind = kindOf(stop);
          const isHere = stop.istituto === here;
          return (
            <li key={stop.istituto} className="relative">
              <button
                type="button"
                // The name says what the stop holds, not only the cards due (a stop of new cards is not «niente da ripassare»).
                aria-label={`Ripassa ${stop.istituto}: ${stopLine(stop)}${isHere ? ', sei qui' : ''}`}
                aria-current={isHere ? 'step' : undefined}
                onClick={() => navigate(instituteSessionPath(materia, stop.istituto))}
                className={cn(
                  'group flex w-full items-center gap-4 rounded-xl py-1 pl-1 pr-2 text-left transition-colors sm:py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60',
                  FOCUS_RING,
                )}
              >
                <Node kind={kind} due={stop.dovute} />
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-base leading-snug text-slate-900 [overflow-wrap:anywhere] sm:text-lg dark:text-slate-50">{stop.istituto}</span>
                  <span id={`${headingId}-${index}`} className={cn('block text-[13px] tabular-nums', MUTED_TEXT)}>{stopLine(stop)}</span>
                </span>
                {/* «Sei qui»: the logo's column, as the sidebar's active entry, and the one start of this subject. */}
                {isHere && (
                  <span className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold', INK_BG, ON_INK)}>
                    <BookMark size={14} />
                    Inizia
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {stops.length > PATH_STOPS_SHOWN && (
        <div className="border-t border-slate-200 px-5 py-2 dark:border-slate-800">
          <button type="button" aria-expanded={all} onClick={() => setAll((open) => !open)} className={QUIET_BUTTON}>
            {all ? `Mostra solo i primi ${PATH_STOPS_SHOWN}` : `Mostra tutti gli istituti (${stops.length})`}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The subject's first node (LC62): its short lesson (LC63). Closed, with the reason said, while the subject has fewer
 * cards than the server needs to build one — the one lock the cards' road has, because the server holds it too; the
 * institutes stay open (their cards due must be reviewable).
 */
function LessonNode({ materia, label, cards }: { materia: Materia; label: string; cards: number }) {
  const open = cards >= LESSON_MIN_CARDS;
  const line = open ? '5–8 esercizi sulle tue schede' : `Chiusa: servono almeno ${LESSON_MIN_CARDS} schede (ne hai ${cards})`;
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full',
          open ? cn(INK_BG, ON_INK) : 'border-2 border-dashed border-slate-300 bg-card text-slate-500 dark:border-slate-700 dark:text-slate-400',
        )}
      >
        {open ? <ListChecks size={20} /> : <Lock size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-base leading-snug text-slate-900 sm:text-lg dark:text-slate-50">Lezione breve</span>
        <span className={cn('block text-[13px]', MUTED_TEXT)}>{line}</span>
      </span>
    </>
  );
  const row = 'flex w-full items-center gap-4 rounded-xl py-1 pl-1 pr-2 text-left sm:py-2';
  return (
    <div className="border-b border-slate-200 px-4 py-1 sm:px-5 sm:py-2 dark:border-slate-800">
      {open ? (
        <Link to={lessonPath(materia)} aria-label={`Lezione breve di ${label}: ${line}`} className={cn(row, 'transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/60', FOCUS_RING)}>
          {body}
        </Link>
      ) : (
        // Focusable though it leads nowhere: the keyboard reaches it and hears why it is closed.
        <div role="group" tabIndex={0} aria-label={`Lezione breve di ${label}, chiusa: servono almeno ${LESSON_MIN_CARDS} schede (ne hai ${cards})`} className={cn(row, FOCUS_RING)}>
          {body}
        </div>
      )}
    </div>
  );
}

export interface LearnPathProps {
  percorso: PercorsoState;
  /** The day's read: the subjects' counts. */
  materie: Progressi['materie'] | null;
  onRetry: () => void;
  /** Opens the study settings at the community's subjects (the way to cards without writing them). */
  onOpenCommunity: () => void;
}

/**
 * «Il tuo sentiero» (LC23, LC62: Learn's home after Duolingo's: the road in the middle of the page, the day's numbers
 * beside it): first the courses' units while «Percorsi» is on (`CourseTrail`), then each subject with cards as a unit —
 * its short lesson (closed under `LESSON_MIN_CARDS`), then its institutes as stops on one line, the first with cards due
 * marked «Sei qui» with the logo's column and «Inizia». Every institute is open, no lock: there is no curriculum behind
 * them, and a lock the server does not hold would be a fake one. The subjects with no card are named once at the foot,
 * with the two ways to get some.
 */
export function LearnPath({ percorso, materie, onRetry, onOpenCommunity }: LearnPathProps) {
  const heading = (
    <h2 id="studia-percorso" className={BLOCK_HEADING}>
      Il tuo sentiero
    </h2>
  );

  if (percorso.data === null) {
    return (
      <section aria-labelledby="studia-percorso" aria-busy={percorso.status === 'loading'} className="grid gap-3">
        {heading}
        {percorso.status === 'error' ? (
          <div className="grid gap-1">
            <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Non riesco a leggere il tuo sentiero.</p>
            <button type="button" onClick={onRetry} className={QUIET_BUTTON}>
              Riprova
            </button>
          </div>
        ) : (
          <div aria-hidden className={cn(TILE, 'h-64 motion-safe:animate-pulse')} />
        )}
      </section>
    );
  }

  const subjects = [...new Set(percorso.data.map((stop) => stop.materia))];
  const units = subjects
    .map((materia) => ({ materia, stops: orderInstitutes(percorso.data!, materia) }))
    .filter((unit) => unit.stops.length > 0)
    // The subject with the most cards due first, as the day block's sentence reads them.
    .sort((a, b) => b.stops.reduce((s, x) => s + x.dovute, 0) - a.stops.reduce((s, x) => s + x.dovute, 0));
  // A subject has cards when the road or the day's counts say so (a subject's cards may have no institute row yet).
  const withCards = (materia: Materia) => subjects.includes(materia) || (materie ?? []).some((m) => m.materia === materia && m.nuove + m.apprendimento + m.consolidate > 0);
  const without = (Object.keys(MATERIA_LABEL) as Materia[]).filter((materia) => !withCards(materia));
  // «Sei qui»: the first stop with cards due across the road; with none due, the first with new cards (where to begin);
  // with neither, none.
  const firstWith = (test: (stop: TappaIstituto) => boolean) => {
    const unit = units.find((u) => u.stops.some(test));
    return unit ? { materia: unit.materia, istituto: unit.stops.find(test)!.istituto } : null;
  };
  const here = firstWith((stop) => stop.dovute > 0) ?? firstWith((stop) => stop.nuove > 0);

  return (
    <section aria-labelledby="studia-percorso" aria-busy={percorso.status === 'loading'} className="grid gap-4">
      {heading}
      <CourseTrail />
      {percorso.status === 'error' && (
        <div className="grid gap-1">
          <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Non riesco ad aggiornare il sentiero: resta quello letto prima.</p>
          <button type="button" onClick={onRetry} className={QUIET_BUTTON}>
            Riprova
          </button>
        </div>
      )}
      {units.map((unit) => (
        <Unit
          key={unit.materia}
          materia={unit.materia}
          stops={unit.stops}
          counts={materie?.find((m) => m.materia === unit.materia)}
          here={here?.materia === unit.materia ? here.istituto : null}
        />
      ))}
      {without.length > 0 && (
        <div className={cn('rounded-2xl border border-dashed border-slate-300 px-5 py-4 dark:border-slate-700')}>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {units.length === 0 ? 'Il percorso nasce dalle tue schede. ' : ''}
            <span className="font-medium">{without.map((materia) => MATERIA_LABEL[materia]).join(', ')}</span>
            : nessuna scheda, per ora.
          </p>
          <p className={cn('mt-1 text-sm', MUTED_TEXT)}>Scrivine una sotto un articolo che apri in Ricerca, o accendi le schede della comunità.</p>
          <button type="button" onClick={onOpenCommunity} className={cn(QUIET_BUTTON, 'mt-1')}>
            Scegli le schede della comunità
          </button>
        </div>
      )}
    </section>
  );
}
