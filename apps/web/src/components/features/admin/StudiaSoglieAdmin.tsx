import { useEffect, useId, useState } from 'react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import * as adminService from '../../../services/adminService';
import type { StudiaSoglie, StudiaSoglieEffetto, StudiaSoglieSettings } from '../../../services/adminService';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Toast } from '../../ui/Toast';

const PANEL = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800';

/** A whole number as typed, or null: the field may hold any text while the admin types. */
const wholeNumber = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text) : null);

type Draft = { approvazioni: string; errate: string };

/** The draft as numbers when both are valid, and which of the two is not (each field says its own). */
function checkDraft(draft: Draft, settings: StudiaSoglieSettings) {
  const approvazioni = wholeNumber(draft.approvazioni);
  const errate = wholeNumber(draft.errate);
  const { limiti } = settings;
  const approvazioniFuori = approvazioni === null || approvazioni < limiti.approvazioni.min || approvazioni > limiti.approvazioni.max;
  const erroreFuori = errate === null || errate < limiti.errate.min || errate > limiti.errate.max;
  const soglie: StudiaSoglie | null = approvazioni !== null && errate !== null && !approvazioniFuori && !erroreFuori ? { approvazioni, errate } : null;
  return { soglie, approvazioniFuori, erroreFuori };
}

/**
 * The admin's validation thresholds in «Testi di VisuaLex Studia»: how many approvals validate a
 * proposed card and how many «errata» archive it. Before saving, the admin sees what the values would
 * do to the proposed cards now; the save recomputes them, and validated or archived cards never change.
 */
export function StudiaSoglieAdmin() {
  const headingId = useId();
  const [settings, setSettings] = useState<StudiaSoglieSettings | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped to read again, on «Riprova».
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Each answer is kept with the two numbers it was asked for: it shows only while they are the draft's.
  const [preview, setPreview] = useState<{ key: string; effetto: StudiaSoglieEffetto } | null>(null);
  const [previewFailed, setPreviewFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminService.studiaSoglie().then(
      (value) => {
        if (!live) return;
        setSettings(value);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [round]);

  const current = settings?.soglie;
  const shown: Draft | null = draft ?? (current ? { approvazioni: String(current.approvazioni), errate: String(current.errate) } : null);
  const checked = settings && shown ? checkDraft(shown, settings) : null;
  const soglie = checked?.soglie ?? null;
  const changed = soglie !== null && current !== undefined && (soglie.approvazioni !== current.approvazioni || soglie.errate !== current.errate);

  // The preview follows the draft a moment after the last keystroke; an answer for an older draft is dropped.
  const previewApprovazioni = changed && soglie ? soglie.approvazioni : null;
  const previewErrate = changed && soglie ? soglie.errate : null;
  const previewKey = previewApprovazioni === null || previewErrate === null ? null : `${previewApprovazioni}/${previewErrate}`;
  useEffect(() => {
    if (previewApprovazioni === null || previewErrate === null || previewKey === null) return;
    let live = true;
    const timer = window.setTimeout(() => {
      adminService.previewStudiaSoglie({ approvazioni: previewApprovazioni, errate: previewErrate }).then(
        (effetto) => live && setPreview({ key: previewKey, effetto }),
        () => live && setPreviewFailed(previewKey),
      );
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [previewApprovazioni, previewErrate, previewKey]);
  const effetto = preview && preview.key === previewKey ? preview.effetto : null;
  const anteprimaFallita = previewKey !== null && previewFailed === previewKey;

  const edit = (field: keyof Draft) => (value: string) => {
    setDraft({ ...(shown ?? { approvazioni: '', errate: '' }), [field]: value });
  };

  const save = async () => {
    if (!soglie) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const esito = await adminService.saveStudiaSoglie(soglie);
      setSettings((before) => (before ? { ...before, soglie: esito.soglie } : before));
      setDraft(null);
      setPreview(null);
      setSaved(`Soglie salvate. ${esito.validate} schede validate, ${esito.archiviate} archiviate.`);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (failed && !settings) {
    return (
      <section aria-labelledby={headingId} className={PANEL}>
        <h3 id={headingId} className="text-base font-semibold text-gray-900 dark:text-white">Soglie di validazione</h3>
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <p>Non riesco a leggere le soglie. Riprova.</p>
          <Button variant="outline" size="sm" onClick={() => setRound((value) => value + 1)}>
            Riprova
          </Button>
        </div>
      </section>
    );
  }

  if (!settings || !shown) {
    return (
      <section aria-labelledby={headingId} className={PANEL}>
        <h3 id={headingId} className="text-base font-semibold text-gray-900 dark:text-white">Soglie di validazione</h3>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Carico le soglie…</p>
      </section>
    );
  }

  const { limiti, predefinite } = settings;
  const testoApprovazioni = `Da ${limiti.approvazioni.min} a ${limiti.approvazioni.max}.`;
  const testoErrate = `Da ${limiti.errate.min} a ${limiti.errate.max}.`;
  const canSave = Boolean(soglie && changed && effetto && !anteprimaFallita && !saving);

  return (
    <section aria-labelledby={headingId} className={cn(PANEL, 'space-y-5')}>
      <div className="space-y-1">
        <h3 id={headingId} className="text-base font-semibold text-gray-900 dark:text-white">Soglie di validazione</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Quante approvazioni validano una scheda proposta, e quante «errata» la archiviano. Le schede già validate o archiviate non cambiano.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Approvazioni per validare"
          type="number"
          inputMode="numeric"
          min={limiti.approvazioni.min}
          max={limiti.approvazioni.max}
          value={shown.approvazioni}
          error={checked?.approvazioniFuori ? testoApprovazioni : undefined}
          helperText={`Predefinito: ${predefinite.approvazioni}`}
          onChange={(e) => edit('approvazioni')(e.target.value)}
        />
        <Input
          label="«Errata» per archiviare"
          type="number"
          inputMode="numeric"
          min={limiti.errate.min}
          max={limiti.errate.max}
          value={shown.errate}
          error={checked?.erroreFuori ? testoErrate : undefined}
          helperText={`Predefinito: ${predefinite.errate}`}
          onChange={(e) => edit('errate')(e.target.value)}
        />
      </div>

      <div aria-live="polite" className="min-h-[1.25rem] text-sm text-gray-700 dark:text-gray-300">
        {!changed && <p className="text-gray-500 dark:text-gray-400">Le soglie in vigore sono {current?.approvazioni} approvazioni e {current?.errate} «errata».</p>}
        {changed && anteprimaFallita && <p className="text-red-600 dark:text-red-400">Non riesco a calcolare l’effetto. Modifica il valore per riprovare.</p>}
        {changed && !anteprimaFallita && !effetto && <p className="text-gray-500 dark:text-gray-400">Calcolo l’effetto…</p>}
        {changed && effetto && (
          <p>
            Con questa soglia {effetto.validate} schede diventano validate e {effetto.archiviate} archiviate.
          </p>
        )}
      </div>

      {saveFailed && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <p>Non sono riuscito a salvare le soglie. Riprova.</p>
        </div>
      )}

      <div>
        <Button disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Salvo…' : 'Salva'}
        </Button>
      </div>

      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        <Toast message={saved ?? ''} type="success" isVisible={saved !== null} onClose={() => setSaved(null)} />
      </div>
    </section>
  );
}
