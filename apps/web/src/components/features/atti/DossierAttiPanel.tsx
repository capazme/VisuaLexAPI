import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { Button } from '../../ui/Button';
import { saveBlob } from '../../../utils/saveBlob';
import { attiError, attiService, type AttoSummary } from '../../../services/attiService';
import { IstruzioniPerClaude } from './IstruzioniPerClaude';
import { PraticaFilesPanel } from './PraticaFilesPanel';
import { attoDocx } from './attoDocx';
import { fileNameOf } from './attiText';

const HEADING = 'text-lg font-semibold text-slate-900 dark:text-slate-50';

/**
 * The dossier's «Atti» tab (LC53, spec §12–§14): the case's instructions for Claude, its files with their versions,
 * and the upload, one under the other. The acts written with the editor that LC53 removed stay readable here, as Word
 * files, while they exist.
 */
export function DossierAttiPanel({ dossierId, onCount }: { dossierId: string; onCount?: (count: number) => void }) {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <OldDrafts dossierId={dossierId} />
      <IstruzioniPerClaude dossierId={dossierId} headingClass={HEADING} />
      <PraticaFilesPanel dossierId={dossierId} headingClass={HEADING} onCount={onCount} />
    </div>
  );
}

/** The editor's acts of this dossier (the old `/api/atti`, untouched), each downloadable as a DOCX built in the browser. */
function OldDrafts({ dossierId }: { dossierId: string }) {
  const [drafts, setDrafts] = useState<AttoSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    attiService.list(dossierId).then(
      (list) => alive && setDrafts(list),
      // shortcut: a failed read shows no drafts; they stay on the server and show at the next opening.
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [dossierId]);

  if (drafts.length === 0) return null;

  const download = async (draft: AttoSummary) => {
    setError(null);
    try {
      const atto = await attiService.get(draft.id);
      saveBlob(await attoDocx(atto.titolo, atto.testo), fileNameOf(atto.titolo, 'docx'));
    } catch (failure) {
      setError(attiError(failure, 'La bozza non è stata scaricata. Riprova.'));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
      <p className="font-medium text-slate-900 dark:text-slate-50">
        {drafts.length === 1 ? 'Hai 1 bozza scritta nella versione precedente' : `Hai ${drafts.length} bozze scritte nella versione precedente`}
      </p>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        L’editor degli atti non c’è più: scarica il testo come file Word e, se ti serve qui, caricalo tra i file.
      </p>
      <ul className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 break-words text-sm text-slate-900 dark:text-slate-100">{draft.titolo}</span>
            <Button variant="secondary" size="sm" icon={<FileDown size={14} aria-hidden />} aria-label={`Scarica come Word ${draft.titolo}`} onClick={() => void download(draft)}>
              Scarica come Word
            </Button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-[15px] text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
