import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FileUp } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import { readDocumentFile } from '../documents/documentFile';
import { attiError, attiService, type AttoSummary } from '../../../services/attiService';
import { ATTO_FILE_ACCEPT, changedOn, titleFromFileName } from './attiText';

/**
 * The dossier's «Atti» tab (Luca, 15-11: the acts live in the practice's dossier, beside its sources): the pile of the
 * dossier's acts, the last changed first. An act is loaded from the file it was written in (Word, WordCraft: read in
 * the browser by «Analizza documento»'s reader, never sent but as the act's text), or started empty. Each opens in
 * reading (`AttoEditor`), with the dossier's sources beside it.
 */
export function DossierAttiPanel({ dossierId, onCount }: { dossierId: string; onCount?: (count: number) => void }) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [atti, setAtti] = useState<AttoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [titolo, setTitolo] = useState('');

  useEffect(() => {
    let alive = true;
    attiService
      .list(dossierId)
      .then((list) => {
        if (!alive) return;
        setAtti(list);
        onCount?.(list.length);
      })
      .catch((failure) => alive && setError(attiError(failure, 'Non è stato possibile leggere gli atti del dossier.')));
    return () => {
      alive = false;
    };
  }, [dossierId, reload, onCount]);

  const open = (id: string) => navigate(`/work/atti/${id}`);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setActionError(null);
    const reading = await readDocumentFile(file);
    if (!reading.ok) {
      setActionError(reading.error);
      setBusy(false);
      return;
    }
    try {
      const atto = await attiService.create({ titolo: titleFromFileName(file.name), testo: reading.text, dossierId });
      open(atto.id);
    } catch (failure) {
      setActionError(attiError(failure, 'L’atto non è stato caricato. Riprova.'));
      setBusy(false);
    }
  };

  const createEmpty = async (event: FormEvent) => {
    event.preventDefault();
    if (!titolo.trim()) {
      setActionError('Scrivi il titolo dell’atto.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      open((await attiService.create({ titolo: titolo.trim(), dossierId })).id);
    } catch (failure) {
      setActionError(attiError(failure, 'L’atto non è stato creato. Riprova.'));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Button icon={<FileUp size={16} aria-hidden />} loading={busy} onClick={() => fileInput.current?.click()}>
          Carica un atto
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={ATTO_FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void load(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <form onSubmit={createEmpty} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
            Oppure un atto vuoto
            <input
              value={titolo}
              onChange={(e) => setTitolo(e.target.value)}
              maxLength={300}
              placeholder="Titolo"
              className="h-10 w-64 rounded-lg border border-slate-300 bg-card px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-100"
            />
          </label>
          <Button type="submit" variant="secondary" disabled={busy}>Crea</Button>
        </form>
      </div>
      <p className="max-w-prose text-sm text-slate-600 dark:text-slate-400">
        Carica l’atto dal file in cui lo scrivi (Word, WordCraft: .docx, .txt, .md, .html). Il file si legge nel tuo browser; nel dossier resta il suo testo.
      </p>
      {actionError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{actionError}</p>}

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
          {error}
          <Button variant="secondary" size="sm" onClick={() => { setError(null); setReload((n) => n + 1); }}>Riprova</Button>
        </div>
      ) : atti === null ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Caricamento…</p>
      ) : atti.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Questo dossier non ha ancora atti.</p>
      ) : (
        <ul aria-label="Atti del dossier" className="border-t border-slate-200 dark:border-slate-800">
          {atti.map((atto) => (
            <li key={atto.id} className="border-b border-slate-200 dark:border-slate-800">
              <Link to={`/work/atti/${atto.id}`} className={cn('flex items-center gap-4 px-2 py-3 transition-colors hover:bg-slate-100 dark:hover:bg-slate-900', FOCUS_RING)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-lg text-slate-900 dark:text-slate-50">{atto.titolo}</span>
                  <span className="block truncate text-sm text-slate-600 dark:text-slate-400">
                    {[atto.tipo, `modificato il ${changedOn(atto.updatedAt)}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={cn(
                  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  atto.stato === 'finale' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
                )}>
                  {atto.stato === 'finale' ? 'Finale' : 'Bozza'}
                </span>
                <ChevronRight aria-hidden size={16} className="shrink-0 text-slate-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
