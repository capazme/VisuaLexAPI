import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { showUndoToast } from '../../../../hooks/useUndoableAction';
import { corsiErrorDetail, corsiService } from '../../../../services/corsiService';
import { trashService } from '../../../../services/trashService';
import { loadAssistantFeatures } from '../../../../store/assistantProposals';
import type { CorsoPagina, ModuloPagina } from '../../../../types/corsi';
import { slugify } from '../../../../utils/annotationExport';
import { saveBlob } from '../../../../utils/saveBlob';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { MenuButton } from '../../../ui/MenuButton';
import { Modal } from '../../../ui/Modal';
import { notify } from '../../../ui/notifications/notifications';
import { MATERIA_LABEL } from '../studiaLabels';
import { FOCUS_RING, MUTED_TEXT, QUIET_BUTTON, subjectHue } from '../progress/tokens';
import { CourseStateChip } from './CourseChips';
import { CoursesGate } from './CoursesGate';
import { CompetencesSection, DossierLink, ExamSection, ModulesSection, PreparationPanel } from './CourseSections';
import { ReadFailure } from './ReadFailure';
import { COURSES_PATH, longDay } from './corsiLabels';
import { coursesChanged, useCourseRead } from './useCourseRead';

/** The longest title the server takes (`PATCH /lingo/corsi/:id`). */
const TITLE_MAX = 200;

/** The course page (`/studia/percorsi/:id`, courses spec §6.4), behind the switch. */
export function CoursePage() {
  const { id = '' } = useParams();
  return (
    <CoursesGate>
      <Course key={id} id={id} />
    </CoursesGate>
  );
}

type Confirming =
  | { kind: 'end-programme'; contati: number }
  | { kind: 'withdraw'; modulo: ModuloPagina }
  | null;

function Course({ id }: { id: string }) {
  const navigate = useNavigate();
  const course = useCourseRead(() => corsiService.get(id), `corso:${id}`);
  const notFound = course.status === 'error' && course.notFound;
  // A 404 may be the switch turned off meanwhile: the features read again tells, and the gate goes back to «Oggi».
  useEffect(() => {
    if (notFound) void loadAssistantFeatures();
  }, [notFound]);

  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busyModule, setBusyModule] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = course.data;
  if (data === null) {
    if (course.status === 'loading') {
      return (
        <p role="status" className={cn('text-sm', MUTED_TEXT)}>
          Caricamento del percorso…
        </p>
      );
    }
    if (notFound) return <CourseNotFound />;
    return <ReadFailure what="il percorso" offline={course.status === 'error' && course.offline} onRetry={course.reload} />;
  }

  const fail = (error: unknown, fallback: string) => notify({ type: 'error', message: corsiErrorDetail(error, fallback), duration: 5000 });

  const trashCourse = () => {
    const kept = data.dossier ? ` Il dossier «${data.dossier.name}» resta in Dossier.` : '';
    showUndoToast({
      action: async () => {
        try {
          const { trashId } = await corsiService.trash(data.id);
          navigate(COURSES_PATH);
          return trashId;
        } catch (error) {
          fail(error, 'Percorso non eliminato.');
          throw error;
        }
      },
      undo: async (trashId) => {
        try {
          await trashService.restore(trashId);
          coursesChanged();
        } catch (error) {
          fail(error, `Impossibile ripristinare «${data.titolo}» ora: è nel Cestino, ripristinalo da lì.`);
          throw error;
        }
      },
      message: `Percorso «${data.titolo}» spostato nel cestino.${kept}`,
    }).catch(() => {
      // Refused: said, and the course stays where it was.
    });
  };

  const trashModule = (modulo: ModuloPagina) => {
    setBusyModule(modulo.id);
    showUndoToast({
      action: async () => {
        try {
          const { trashId } = await corsiService.trashModule(data.id, modulo.id);
          course.reload();
          return trashId;
        } catch (error) {
          fail(error, 'Modulo non eliminato.');
          throw error;
        } finally {
          setBusyModule(null);
        }
      },
      undo: async (trashId) => {
        try {
          await trashService.restore(trashId);
          coursesChanged();
        } catch (error) {
          fail(error, `Impossibile ripristinare il modulo «${modulo.titolo}» ora: è nel Cestino, ripristinalo da lì.`);
          throw error;
        }
      },
      message: `Modulo «${modulo.titolo}» spostato nel cestino.`,
    }).catch(() => {});
  };

  const withdraw = async (modulo: ModuloPagina) => {
    setConfirming(null);
    setBusyModule(modulo.id);
    try {
      await corsiService.withdrawModule(data.id, modulo.id);
      notify({ type: 'success', message: `Modulo «${modulo.titolo}» ritirato.`, duration: 4000 });
      course.reload();
    } catch (error) {
      fail(error, 'Modulo non ritirato.');
    } finally {
      setBusyModule(null);
    }
  };

  const endProgramme = async (contati: number) => {
    setConfirming(null);
    setBusy(true);
    try {
      await corsiService.endProgrammeAt(data.id, contati);
      notify({ type: 'success', message: `Il programma finisce con ${contati} ${contati === 1 ? 'modulo' : 'moduli'}.`, duration: 4000 });
      coursesChanged();
    } catch (error) {
      fail(error, 'Programma non modificato.');
    } finally {
      setBusy(false);
    }
  };

  const exportCourse = async () => {
    try {
      const body = await corsiService.export(data.id);
      saveBlob(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }), `percorso-${slugify(data.titolo) || data.id}.json`);
    } catch (error) {
      fail(error, 'Esportazione non riuscita.');
    }
  };

  const contati = data.inPreparazione?.moduli.contati ?? 0;
  const canEnd = data.inPreparazione !== null && contati >= 1 && contati < data.inPreparazione.moduli.previsti;

  return (
    <div className="grid grid-cols-1 gap-8 pb-8">
      {course.status === 'error' && <ReadFailure what="il percorso" offline={course.offline} stale onRetry={course.reload} />}
      <CourseHeader
        data={data}
        onRename={() => setRenaming(true)}
        onExport={() => void exportCourse()}
        onTrash={trashCourse}
      />

      {data.inPreparazione && (
        <PreparationPanel
          titolo={data.titolo}
          missing={data.inPreparazione}
          busy={busy}
          onEndProgramme={canEnd ? () => setConfirming({ kind: 'end-programme', contati }) : null}
        />
      )}

      <CompetencesSection competenze={data.competenze} />
      <ModulesSection
        moduli={data.moduli}
        actions={{ onDelete: trashModule, onWithdraw: (modulo) => setConfirming({ kind: 'withdraw', modulo }), busyId: busyModule }}
      />
      <ExamSection titolo={data.titolo} esame={data.esame} inPreparazione={data.inPreparazione !== null} />

      <section aria-labelledby="corso-dossier" className="grid grid-cols-1 gap-3">
        <h2 id="corso-dossier" className="font-serif text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
          Dossier del percorso
        </h2>
        <DossierLink dossier={data.dossier} />
        <p className={cn('text-sm', MUTED_TEXT)}>
          Schede del percorso: {data.schede.dovute} da ripassare oggi · {data.schede.nuove} nuove · {data.schede.inAttesa} in attesa del loro modulo
        </p>
      </section>

      {/* The honest limit (§4), on the course page. */}
      <p className={cn('max-w-[70ch] text-sm leading-relaxed', MUTED_TEXT)}>
        Il percorso misura ciò che hai dimostrato sulle sue domande, a distanza di tempo. Le domande sono bozze scritte dall’AI:
        se ne trovi una sbagliata, segnalala. Le soglie sono stime da verificare con l’uso.
      </p>

      {renaming && (
        <RenameDialog
          id={data.id}
          titolo={data.titolo}
          onClose={() => setRenaming(false)}
          onRenamed={() => {
            setRenaming(false);
            coursesChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={confirming?.kind === 'end-programme'}
        title={confirming?.kind === 'end-programme' ? `Il programma finisce con ${confirming.contati} ${confirming.contati === 1 ? 'modulo' : 'moduli'}?` : ''}
        message="L’esame finale potrà aprirsi con i moduli che ci sono. Il tuo assistente non potrà aggiungerne altri, solo correggerli."
        confirmLabel="Il programma finisce qui"
        onConfirm={() => confirming?.kind === 'end-programme' && void endProgramme(confirming.contati)}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming?.kind === 'withdraw'}
        title={confirming?.kind === 'withdraw' ? `Ritirare il modulo ${confirming.modulo.ordine}?` : ''}
        message="Le sue risposte non conteranno più per le competenze: conta la correzione che lo sostituisce."
        confirmLabel="Ritira il modulo"
        onConfirm={() => confirming?.kind === 'withdraw' && void withdraw(confirming.modulo)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

function CourseHeader({ data, onRename, onExport, onTrash }: { data: CorsoPagina; onRename: () => void; onExport: () => void; onTrash: () => void }) {
  return (
    <header className="grid grid-cols-1 gap-3">
      <Link to={COURSES_PATH} className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1')}>
        <ChevronLeft aria-hidden size={16} />
        Tutti i percorsi
      </Link>
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words font-serif text-2xl font-medium leading-snug tracking-tight text-slate-900 md:text-3xl dark:text-slate-50">
          {data.titolo}
        </h2>
        <MenuButton
          label="Azioni del percorso"
          align="right"
          triggerClassName={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING)}
          items={[
            { label: 'Rinomina', icon: Pencil, onSelect: onRename },
            { label: 'Esporta', icon: Download, onSelect: onExport, description: 'Il percorso e i tuoi esiti, in un file JSON' },
            { label: 'Elimina', icon: Trash2, onSelect: onTrash, danger: true, separatorBefore: true, description: 'Nel cestino per 30 giorni' },
          ]}
        >
          <MoreHorizontal aria-hidden size={20} />
        </MenuButton>
      </div>
      <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', MUTED_TEXT)}>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subjectHue(data.materia) }} />
          {MATERIA_LABEL[data.materia]}
        </span>
        <CourseStateChip stato={data.stato} />
        {data.superatoIl && <span>Percorso superato il {longDay(data.superatoIl)}</span>}
      </p>
      {data.descrizione && <p className="max-w-[70ch] break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">{data.descrizione}</p>}
    </header>
  );
}

function CourseNotFound() {
  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">Questo percorso non c’è: forse è stato eliminato.</p>
      <Link to={COURSES_PATH} className={cn(QUIET_BUTTON, 'mx-0')}>
        Torna ai percorsi
      </Link>
    </div>
  );
}

function RenameDialog({ id, titolo, onClose, onRenamed }: { id: string; titolo: string; onClose: () => void; onRenamed: () => void }) {
  const [value, setValue] = useState(titolo);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const next = value.trim();
  const valid = next.length >= 1 && next.length <= TITLE_MAX;

  const save = async () => {
    if (!valid || saving) return;
    if (next === titolo) return onClose();
    setSaving(true);
    setError(null);
    try {
      await corsiService.rename(id, next);
      onRenamed();
    } catch (failure) {
      setError(corsiErrorDetail(failure, 'Nome non salvato: riprova.'));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Rinomina il percorso"
      size="sm"
      initialFocusRef={input}
      footer={
        <>
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={onClose}>
            Annulla
          </Button>
          <Button size="sm" className="min-h-[44px]" disabled={!valid || saving} onClick={() => void save()}>
            Salva
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="grid grid-cols-1 gap-2"
      >
        <label htmlFor={inputId} className="text-sm font-medium text-slate-800 dark:text-slate-100">
          Nome
        </label>
        <input
          ref={input}
          id={inputId}
          value={value}
          maxLength={TITLE_MAX}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={!valid}
          aria-describedby={error ? `${inputId}-errore` : undefined}
          className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        />
        {error && (
          <p id={`${inputId}-errore`} role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
