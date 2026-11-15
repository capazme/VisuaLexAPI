import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Download, FileUp, Link2, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../../../constants/interactions';
import { dossierService, type DossierApi } from '../../../services/dossierService';
import { readDocumentFile } from '../documents/documentFile';
import { ATTO_FILE_ACCEPT, SAVE_DELAY_MS, citationOf, noteTextOf } from './attiText';
import { ATTO_TIPI, MAX_TESTO, attiError, attiService, type Atto, type AttoStato } from '../../../services/attiService';


type Draft = Pick<Atto, 'titolo' | 'tipo' | 'testo' | 'stato' | 'dossierId'>;
type SaveState = { kind: 'saved'; at: Date } | { kind: 'pending' } | { kind: 'saving' } | { kind: 'error'; message: string };

const FIELD =
  'h-10 rounded-lg border border-slate-300 bg-card px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-100';


/**
 * An act of a dossier (`/work/atti/:id`), to read first (Luca, 15-11: the act is written in Word or WordCraft, LexCraft is
 * where it is read and checked): the text as a page, and beside it the dossier's norms and decisions and its notes. A new
 * version comes from its file («Carica una nuova versione», after a confirmation); «Modifica il testo» opens the text to
 * a correction, which saves itself `SAVE_DELAY_MS` after the last change («Cita» then writes a source where the cursor
 * is). Title, kind, dossier and state save the same way. The text can be copied or downloaded; «Elimina» asks first.
 */
export function AttoEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: new Date() });
  const [dossiers, setDossiers] = useState<DossierApi[]>([]);
  const [sources, setSources] = useState<DossierApi['items']>([]);
  const [notes, setNotes] = useState<DossierApi['items']>([]);
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<Draft | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);

  useEffect(() => {
    let alive = true;
    attiService
      .get(id)
      .then((atto) => {
        if (!alive) return;
        const loaded = { titolo: atto.titolo, tipo: atto.tipo, testo: atto.testo, stato: atto.stato, dossierId: atto.dossierId };
        latest.current = loaded;
        setDraft(loaded);
        // An empty act opens to be written; one with a text, to be read.
        setEditing(!atto.testo.trim());
        setSave({ kind: 'saved', at: new Date(atto.updatedAt) });
      })
      .catch((error) => alive && setLoadError(attiError(error, 'Non è stato possibile aprire l’atto.')));
    dossierService.getAll().then((list) => alive && setDossiers(list)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  // The linked dossier's sources (its norms and decisions) and its notes, in the dossier's order.
  const dossierId = draft?.dossierId ?? null;
  useEffect(() => {
    let alive = true;
    // No dossier: the column is not drawn, and what it held waits for the next one.
    if (!dossierId) return undefined;
    dossierService
      .getById(dossierId)
      .then((dossier) => {
        if (!alive) return;
        setSources(dossier.items.filter((item) => item.item_type === 'norm' || item.item_type === 'sentenza'));
        setNotes(dossier.items.filter((item) => item.item_type === 'note' && noteTextOf(item)));
      })
      .catch(() => {
        if (!alive) return;
        setSources([]);
        setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, [dossierId]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const current = latest.current;
    if (!current || !dirty.current) return;
    if (!current.titolo.trim()) {
      setSave({ kind: 'error', message: 'Il titolo è obbligatorio: l’atto non è stato salvato.' });
      return;
    }
    dirty.current = false;
    setSave({ kind: 'saving' });
    try {
      await attiService.update(id, current);
      // A change typed while the save travelled waits for its own.
      setSave(dirty.current ? { kind: 'pending' } : { kind: 'saved', at: new Date() });
    } catch (error) {
      dirty.current = true;
      setSave({ kind: 'error', message: attiError(error, 'Salvataggio non riuscito.') });
    }
  }, [id]);

  const change = (patch: Partial<Draft>) => {
    setDraft((before) => {
      if (!before) return before;
      const next = { ...before, ...patch };
      latest.current = next;
      return next;
    });
    dirty.current = true;
    setSave({ kind: 'pending' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  // Leaving the page saves what is pending; closing the tab with a change not saved asks first.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flush();
    };
  }, [flush]);

  const cite = (text: string) => {
    const area = textRef.current;
    const testo = latest.current?.testo ?? '';
    const start = area?.selectionStart ?? testo.length;
    const end = area?.selectionEnd ?? testo.length;
    const next = testo.slice(0, start) + text + testo.slice(end);
    change({ testo: next });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const readNewVersion = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    const reading = await readDocumentFile(file);
    if (reading.ok) setNewVersion({ name: file.name, text: reading.text });
    else setFileError(reading.error);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(latest.current?.testo ?? '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const current = latest.current;
    if (!current) return;
    const blob = new Blob([current.testo], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${current.titolo.trim().replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 100) || 'atto'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const remove = async () => {
    setConfirmDelete(false);
    window.clearTimeout(timer.current);
    dirty.current = false;
    try {
      await attiService.remove(id);
      navigate('/work/atti');
    } catch (error) {
      setDeleteError(attiError(error, 'L’atto non è stato eliminato. Riprova.'));
    }
  };

  // Back to the dossier's acts when the act has one; else to all the acts.
  const backTo = draft?.dossierId ? `/dossier?dossier=${encodeURIComponent(draft.dossierId)}&vista=atti` : '/work/atti';
  const back = (
    <Link to={backTo} className={cn('inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100', FOCUS_RING)}>
      <ArrowLeft aria-hidden size={15} />
      {draft?.dossierId ? 'Atti del dossier' : 'Tutti gli atti'}
    </Link>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p role="alert" className="text-sm text-slate-700 dark:text-slate-300">{loadError}</p>
      </div>
    );
  }
  if (!draft) return <div className="flex flex-col gap-4">{back}<p className="text-sm text-slate-600 dark:text-slate-400">Caricamento…</p></div>;

  const saveWords =
    save.kind === 'saved'
      ? `Salvato alle ${save.at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
      : save.kind === 'error'
        ? save.message
        : 'Salvataggio…';
  const near = draft.testo.length > MAX_TESTO * 0.9;

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <p role="status" className={cn('flex items-center gap-2 text-sm', save.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'text-slate-600 dark:text-slate-400')}>
          {saveWords}
          {save.kind === 'error' && <Button size="sm" variant="secondary" onClick={() => void flush()}>Riprova</Button>}
        </p>
      </div>

      <label className="sr-only" htmlFor="atto-titolo">Titolo dell’atto</label>
      <input
        id="atto-titolo"
        value={draft.titolo}
        onChange={(e) => change({ titolo: e.target.value })}
        onBlur={() => void flush()}
        maxLength={300}
        className="w-full border-b border-transparent bg-transparent pb-1 font-serif text-[28px] leading-tight text-slate-900 focus-visible:border-slate-400 focus-visible:outline-none md:text-3xl dark:text-slate-50"
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          Tipo
          <input value={draft.tipo ?? ''} onChange={(e) => change({ tipo: e.target.value.trim() ? e.target.value : null })} list="atto-tipi" maxLength={100} className={cn(FIELD, 'w-60')} />
          <datalist id="atto-tipi">{ATTO_TIPI.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          Dossier
          <select value={draft.dossierId ?? ''} onChange={(e) => change({ dossierId: e.target.value || null })} className={cn(FIELD, 'w-60')}>
            <option value="">Nessuno</option>
            {dossiers.filter((d) => d.kind !== 'studio' || d.id === draft.dossierId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <div role="radiogroup" aria-label="Stato" className="flex h-10 items-center gap-0.5 rounded-lg border border-slate-300 bg-card p-0.5 dark:border-slate-700">
          {(['bozza', 'finale'] as AttoStato[]).map((stato) => (
            <button
              key={stato}
              type="button"
              role="radio"
              aria-checked={draft.stato === stato}
              onClick={() => change({ stato })}
              className={cn('h-full rounded-md px-3 text-sm font-medium', FOCUS_RING, draft.stato === stato ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-50' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400')}
            >
              {stato === 'bozza' ? 'Bozza' : 'Finale'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<FileUp size={15} aria-hidden />} onClick={() => fileInput.current?.click()}>Carica una nuova versione</Button>
          <input
            ref={fileInput}
            type="file"
            accept={ATTO_FILE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              void readNewVersion(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button variant="secondary" size="sm" icon={<Copy size={15} aria-hidden />} onClick={() => void copy()}>{copied ? 'Copiato' : 'Copia il testo'}</Button>
          <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} onClick={download}>Scarica .txt</Button>
          {/* Quiet: a destructive action seen at every visit; the confirmation is where it turns red. */}
          <Button variant="quiet" size="sm" icon={<Trash2 size={15} aria-hidden />} onClick={() => setConfirmDelete(true)} className="text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300">Elimina</Button>
        </div>
      </div>
      {deleteError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{deleteError}</p>}
      {fileError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{fileError}</p>}

      <div className={cn('grid grid-cols-1 gap-5', draft.dossierId && 'lg:grid-cols-[minmax(0,1fr)_17rem]')}>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {/* «Analizza documento» in the act's flow (Luca, 15-11): the citations found, linked to their norms and decisions. */}
            <Button
              variant="secondary"
              size="sm"
              icon={<Link2 size={15} aria-hidden />}
              disabled={!draft.testo.trim()}
              onClick={() => {
                void flush();
                navigate('/documents', { state: { atto: { id, titolo: draft.titolo, testo: draft.testo } } });
              }}
            >
              Analizza l’atto
            </Button>
            <Button variant="quiet" size="sm" icon={<Pencil size={15} aria-hidden />} onClick={() => setEditing((now) => !now)} aria-pressed={editing}>
              {editing ? 'Fine modifica' : 'Modifica il testo'}
            </Button>
          </div>
          {editing ? (<>
          <label className="sr-only" htmlFor="atto-testo">Testo dell’atto</label>
          <textarea
            id="atto-testo"
            ref={textRef}
            value={draft.testo}
            onChange={(e) => change({ testo: e.target.value })}
            onBlur={() => void flush()}
            maxLength={MAX_TESTO}
            placeholder="Scrivi qui il testo dell’atto."
            className="min-h-[60vh] w-full resize-y rounded-xl border border-slate-200 bg-card px-6 py-5 font-serif text-[17px] leading-relaxed text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-800 dark:text-slate-100"
          />
          {near && <p className="text-xs text-amber-800 dark:text-amber-300">{draft.testo.length.toLocaleString('it-IT')} caratteri su {MAX_TESTO.toLocaleString('it-IT')}.</p>}
          </>) : (
            <article aria-label="Testo dell’atto" className="min-h-[40vh] rounded-xl border border-slate-200 bg-card px-6 py-6 font-serif text-[17px] leading-relaxed text-slate-900 md:px-10 dark:border-slate-800 dark:text-slate-100">
              {draft.testo.trim()
                ? draft.testo.split(/\n+/).filter((line) => line.trim()).map((line, index) => <p key={index} className="mb-3 whitespace-pre-wrap last:mb-0">{line}</p>)
                : <p className="text-slate-600 dark:text-slate-400">L’atto non ha ancora un testo. Caricane una versione dal file, o scrivilo con «Modifica il testo».</p>}
            </article>
          )}
        </div>
        {draft.dossierId && (
          <aside aria-labelledby="atto-fonti" className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
            <h2 id="atto-fonti" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Fonti del dossier</h2>
            {sources.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Il dossier non ha ancora norme né sentenze.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-200 rounded-xl border border-slate-200 bg-card dark:divide-slate-800 dark:border-slate-800">
                {sources.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-200" title={citationOf(item)}>{citationOf(item)}</span>
                    {editing && <button type="button" onClick={() => cite(citationOf(item))} aria-label={`Cita ${citationOf(item)}`} className={cn('min-h-11 shrink-0 rounded-md px-3 text-xs font-semibold md:min-h-0 md:px-2 md:py-1 text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING)}>
                      Cita
                    </button>}
                  </li>
                ))}
              </ul>
            )}
            {notes.length > 0 && (
              <>
                <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Note del dossier</h2>
                <ul className="flex flex-col gap-2">
                  {notes.map((item) => (
                    <li key={item.id} className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-card px-3 py-2 font-serif text-[15px] leading-snug text-slate-800 dark:border-slate-800 dark:text-slate-200">
                      {noteTextOf(item)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link to={`/dossier?dossier=${encodeURIComponent(draft.dossierId)}`} className={cn('w-fit rounded-sm text-sm text-slate-600 underline-offset-2 hover:underline dark:text-slate-400', FOCUS_RING)}>Apri il dossier</Link>
          </aside>
        )}
      </div>

      <ConfirmDialog
        open={newVersion !== null}
        title="Sostituire il testo?"
        message={`Il testo dell’atto sarà sostituito da quello di «${newVersion?.name ?? ''}». Il testo di adesso non si potrà recuperare.`}
        confirmLabel="Sostituisci"
        onConfirm={() => {
          if (newVersion) change({ testo: newVersion.text });
          setNewVersion(null);
          setEditing(false);
        }}
        onCancel={() => setNewVersion(null)}
        focusCancel
      />
      <ConfirmDialog
        open={confirmDelete}
        variant="danger"
        title="Eliminare l’atto?"
        message={`«${draft.titolo}» sarà eliminato con il suo testo. Non si può annullare.`}
        confirmLabel="Elimina"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
        focusCancel
      />
    </div>
  );
}
