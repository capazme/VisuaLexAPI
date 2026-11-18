import { useId, useState } from 'react';
import { FolderInput } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { importReport, importToastType, type ImportCheck } from './dossierUtils';
import { countsLine } from './dossierLayout';
import { tagLabel } from '../../../utils/tagLabel';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { CARD_RADIUS, CONTROL_BORDER, CONTROL_RADIUS } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Props {
  /** What a share link or a file holds, checked (`validateImportedDossier`); null, closed. */
  check: ImportCheck | null;
  onClose: () => void;
  /** Opens the dossier the import made. */
  onOpen: (dossierId: string) => void;
  showToast: (message: string, type?: ToastType) => void;
  className?: string;
}

/** What the import did, said in the space when something did not come in: the counts and the server's own words. */
interface Result {
  message: string;
  type: ToastType;
  dossierId?: string;
}

/**
 * «Importa una pratica» in the page (LC107, L-73): a space at the top of the dossiers (`Expand`), never over them. An
 * import that takes everything opens the new dossier, as before; one the server cut short (its caps, G-576: a 409 in
 * Italian) stays here and says how many items came in and why the others did not, in the server's words.
 */
export function ImportDossierPanel({ check, onClose, onOpen, showToast, className }: Props) {
  // The preview stays drawn while the space closes.
  const [shown, setShown] = useState(check);
  if (check && check !== shown) setShown(check);
  const headingId = useId();

  return (
    <Expand
      open={check !== null}
      onClose={onClose}
      role="region"
      aria-labelledby={headingId}
      className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}
    >
      {shown && <ImportBody key={shown.dossier.id + shown.dossier.title} check={shown} headingId={headingId} onClose={onClose} onOpen={onOpen} showToast={showToast} />}
    </Expand>
  );
}

function ImportBody({ check, headingId, onClose, onOpen, showToast }: Omit<Props, 'check' | 'className'> & { check: ImportCheck; headingId: string }) {
  const importDossier = useAppStore((s) => s.importDossier);
  const { dossier, discarded } = check;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const confirm = async () => {
    setBusy(true);
    const outcome = await importDossier(dossier);
    setBusy(false);
    if (!outcome) {
      setResult({ message: 'Impossibile importare la pratica: errore server', type: 'error' });
      return;
    }
    if ('refused' in outcome) {
      setResult({ message: `Pratica non importata. ${outcome.refused}`, type: 'error' });
      return;
    }
    const lost = outcome.failed + discarded.length;
    if (lost === 0) {
      showToast(importReport(outcome.imported, lost), 'success');
      onOpen(outcome.id);
      return;
    }
    const words = outcome.refusals?.length ? ` ${outcome.refusals.join(' ')}` : '';
    setResult({ message: `${importReport(outcome.imported, lost)}.${words}`, type: importToastType(outcome.imported, lost), dossierId: outcome.id });
  };

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div>
        <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-50">
          <FolderInput size={18} aria-hidden className="text-slate-500 dark:text-slate-400" />
          Importa una pratica
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Qualcuno ha condiviso una pratica con te</p>
      </div>

      <div className={cn('space-y-2 bg-slate-50 p-4 dark:bg-slate-800/50', CARD_RADIUS)}>
        <h3 className="break-words font-serif text-lg font-medium text-slate-900 dark:text-slate-50">{dossier.title}</h3>
        {dossier.description && <p className="break-words text-sm text-slate-700 dark:text-slate-300">{dossier.description}</p>}
        {/* The same line as a dossier's card (LC88). */}
        <p className="text-sm text-slate-600 dark:text-slate-400">{countsLine(dossier.items)}</p>
        {dossier.tags && dossier.tags.length > 0 && (
          <ul aria-label="Etichette" className="flex flex-wrap gap-1">
            {dossier.tags.map((tag) => (
              <li key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                {tagLabel(tag)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {discarded.length > 0 && (
        <p role="alert" className={cn('border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200', CONTROL_RADIUS)}>
          {discarded.length} {discarded.length === 1 ? 'voce non importabile' : 'voci non importabili'}:{' '}
          {[...new Set(discarded.map((d) => d.reason))].join('; ')}
        </p>
      )}

      {/* The outcome in the flow: what came in, and the server's words for what did not. */}
      <p role="status" className={cn(result ? 'text-sm font-medium' : 'sr-only', result?.type === 'error' ? 'text-red-700 dark:text-red-300' : 'text-slate-800 dark:text-slate-200')}>
        {busy ? 'Importo la pratica…' : result?.message}
      </p>

      <div className="flex flex-wrap justify-end gap-3">
        {result ? (
          <>
            <Button type="button" variant="quiet" onClick={onClose}>Chiudi</Button>
            {result.dossierId && <Button type="button" onClick={() => onOpen(result.dossierId!)}>Apri la pratica</Button>}
          </>
        ) : (
          <>
            <Button type="button" variant="quiet" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button type="button" onClick={() => void confirm()} disabled={busy} icon={<FolderInput size={16} aria-hidden />}>
              Importa
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
