import { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import * as adminService from '../../../services/adminService';
import type { StudiaTextBody, StudiaTextGroup, StudiaTextVersion } from '../../../services/adminService';
import { formatDateForDisplay, todayInRome } from '../../../utils/dateUtils';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Input } from '../../ui/Input';
import { Toast } from '../../ui/Toast';
import { TextParagraphs } from '../studia/TextParagraphs';

/** How the admin names each text; a key it does not know is shown as it is. */
const KEY_LABEL: Record<string, string> = {
  PROPOSTA_SCHEDA: 'Avviso per proporre una scheda',
};

// The server's limits (`POST /api/admin/studia/testi/:chiave`).
const LIMITS = { titolo: 200, corpo: 8000, conferma: 120, azione: 120 } as const;

const PANEL = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800';
const FIELD_LABEL = 'mb-1 ml-1 block text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400';

/** The day a version was saved, in Rome, as DD/MM/YYYY. */
const dayOf = (createdAt: string) => formatDateForDisplay(todayInRome(new Date(createdAt)));

/** The text as the user will see it: the dialog's title, paragraphs, checkbox and button, inert. */
function TextPreview({ text, label }: { text: StudiaTextBody; label: string }) {
  return (
    <div role="group" aria-label={label} className="space-y-3 rounded-lg border border-dashed border-gray-300 p-4 dark:border-gray-600">
      <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">{text.titolo}</h4>
      <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <TextParagraphs body={text.corpo} />
      </div>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 h-5 w-5 shrink-0 rounded border border-slate-300 dark:border-slate-600" />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{text.conferma}</span>
      </div>
      <div>
        <span className="inline-flex rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white opacity-60">{text.azione}</span>
      </div>
    </div>
  );
}

/** An earlier version, as a row that opens read-only. */
function EarlierVersion({ version }: { version: StudiaTextVersion }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="py-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 rounded text-left text-sm text-gray-700 hover:text-gray-900 md:min-h-0 dark:text-gray-300 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Chevron size={16} aria-hidden className="shrink-0" />
        <span className="font-medium">Versione {version.versione}</span>
        <span className="text-gray-500 dark:text-gray-400">
          {dayOf(version.createdAt)} · {version.autore ?? '—'}
        </span>
      </button>
      {open && (
        <div role="group" aria-label={`Versione ${version.versione}`} className="mt-2 space-y-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-900/40">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{version.titolo}</p>
          <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <TextParagraphs body={version.corpo} />
          </div>
          <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-gray-500 dark:text-gray-400">Etichetta della casella</dt>
            <dd className="text-slate-800 dark:text-slate-100">{version.conferma}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Etichetta del pulsante</dt>
            <dd className="text-slate-800 dark:text-slate-100">{version.azione}</dd>
          </dl>
        </div>
      )}
    </li>
  );
}

interface TextSectionProps {
  group: StudiaTextGroup;
  /** The version the server just created, as it answered. */
  onSaved: (chiave: string, version: StudiaTextVersion) => void;
  onReload: () => void;
}

/**
 * One text: its current version in a form with a live preview, and the versions before it. The
 * section is keyed by the text, not by its version: the draft lives here and outlives a reload of
 * the texts, so a newer version found after a conflict never costs the administrator what was typed.
 */
function TextSection({ group, onSaved, onReload }: TextSectionProps) {
  const [current, ...earlier] = group.versioni;
  const headingId = useId();
  const [draft, setDraft] = useState<StudiaTextBody>({
    titolo: current.titolo, corpo: current.corpo, conferma: current.conferma, azione: current.azione,
  });
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<'conflict' | 'failed' | null>(null);

  const edit = (field: keyof StudiaTextBody) => (value: string) => setDraft((before) => ({ ...before, [field]: value }));
  const changed = (Object.keys(draft) as Array<keyof StudiaTextBody>).some((field) => draft[field] !== current[field]);
  const complete = (Object.values(draft) as string[]).every((value) => value.trim() !== '');
  const next = current.versione + 1;

  const save = async () => {
    setAsking(false);
    setSaving(true);
    setProblem(null);
    try {
      const saved = await adminService.saveStudiaText(group.chiave, draft);
      onSaved(group.chiave, saved);
    } catch (error) {
      setProblem((error as { status?: number } | null)?.status === 409 ? 'conflict' : 'failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className={cn(PANEL, 'space-y-5')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold text-gray-900 dark:text-white">{KEY_LABEL[group.chiave] ?? group.chiave}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Versione attuale: {current.versione}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Input label="Titolo" value={draft.titolo} maxLength={LIMITS.titolo} onChange={(e) => edit('titolo')(e.target.value)} />
          <div>
            <label htmlFor={`${headingId}-corpo`} className={FIELD_LABEL}>Testo</label>
            <textarea
              id={`${headingId}-corpo`}
              value={draft.corpo}
              maxLength={LIMITS.corpo}
              rows={10}
              onChange={(e) => edit('corpo')(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100"
            />
            <p className="ml-1 mt-1 text-xs text-slate-500 dark:text-slate-400">Una riga vuota separa i paragrafi. Il testo è semplice: niente grassetti, link o formattazione.</p>
          </div>
          <Input label="Etichetta della casella" value={draft.conferma} maxLength={LIMITS.conferma} onChange={(e) => edit('conferma')(e.target.value)} />
          <Input label="Etichetta del pulsante" value={draft.azione} maxLength={LIMITS.azione} onChange={(e) => edit('azione')(e.target.value)} />
        </div>
        <div>
          <p className={FIELD_LABEL}>Come lo vedrà l’utente</p>
          <TextPreview text={draft} label="Anteprima" />
        </div>
      </div>

      {problem && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <p>{problem === 'conflict' ? 'Un’altra versione è stata salvata nel frattempo. Ricarica per vederla: le tue modifiche restano nel modulo.' : 'Non sono riuscito a salvare la versione. Riprova.'}</p>
          {problem === 'conflict' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setProblem(null);
                onReload();
              }}
            >
              Ricarica
            </Button>
          )}
        </div>
      )}

      <div>
        <Button disabled={!changed || !complete || saving} onClick={() => setAsking(true)}>
          Salva come nuova versione
        </Button>
      </div>

      {earlier.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Versioni precedenti</h4>
          <ul aria-label="Versioni precedenti" className="divide-y divide-gray-100 dark:divide-gray-700">
            {earlier.map((version) => (
              <EarlierVersion key={version.id} version={version} />
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={asking}
        title="Salvare come nuova versione?"
        message={`Si crea la versione ${next}. Chi ha accettato una versione precedente la vedrà di nuovo alla prossima proposta. Le versioni precedenti restano consultabili.`}
        confirmLabel="Salva"
        onConfirm={() => void save()}
        onCancel={() => setAsking(false)}
      />
    </section>
  );
}

/**
 * The admin's «Testi di VisuaLex Studia»: each text the users accept before an action, its current
 * version in a form with a preview, saved as a new version (never over the old one), and the earlier
 * versions beneath it, readable. The body is plain text, drawn by the same `TextParagraphs` the
 * users' dialog uses.
 */
export function StudiaTextsAdmin() {
  const [groups, setGroups] = useState<StudiaTextGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped to read again, on «Riprova» and «Ricarica». The forms keep what was typed.
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    adminService.studiaTexts().then(
      (texts) => live && setGroups(texts),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [round]);

  const readAgain = () => {
    setFailed(false);
    setRound((value) => value + 1);
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Testi di VisuaLex Studia</h2>

      {failed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <p>Non riesco a leggere i testi. Riprova.</p>
          <Button variant="outline" size="sm" onClick={readAgain}>
            Riprova
          </Button>
        </div>
      )}
      {!groups && !failed && <p className="text-sm text-gray-500 dark:text-gray-400">Carico i testi…</p>}

      {groups?.filter((group) => group.versioni.length > 0).map((group) => (
        <TextSection
          key={group.chiave}
          group={group}
          onSaved={(chiave, version) => {
            // The 201 carries the whole version: it becomes the current one with no second read, so
            // the form never shows the old version beside the new number.
            setGroups((before) => before && before.map((g) => (g.chiave === chiave ? { ...g, versioni: [version, ...g.versioni] } : g)));
            setSaved(version.versione);
          }}
          onReload={readAgain}
        />
      ))}

      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        <Toast message={saved ? `Versione ${saved} salvata` : ''} type="success" isVisible={saved !== null} onClose={() => setSaved(null)} />
      </div>
    </div>
  );
}
