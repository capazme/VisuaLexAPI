import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Download, FileUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { MenuButton } from '../../ui/MenuButton';
import { Sheet } from '../../ui/Sheet';
import { notify } from '../../ui/notifications/notifications';
import { FOCUS_BUTTON_CLEARANCE } from '../../layout/PageFrame';
import { cn } from '../../../lib/utils';
import { FIELD_TEXT, FOCUS_RING } from '../../../constants/interactions';
import { dossierService, type DossierApi } from '../../../services/dossierService';
import { readDocumentFile } from '../documents/documentFile';
import { ATTO_FILE_ACCEPT, SAVE_DELAY_MS } from './attiText';
import { AttoCitazioni } from './AttoCitazioni';
import { AttoFonti } from './AttoFonti';
import { ATTO_TIPI, MAX_TESTO, attiError, attiService, type Atto, type AttoStato, type AttoSummary } from '../../../services/attiService';


type Draft = Pick<Atto, 'titolo' | 'tipo' | 'testo' | 'stato' | 'dossierId'>;
type SaveState = { kind: 'saved'; at: Date } | { kind: 'pending' } | { kind: 'saving' } | { kind: 'error'; message: string };

/** The meta row's controls: one height (44 px on a phone, 32 from `md`), quiet until hovered or focused. */
const META_FIELD = cn(
  'h-11 rounded-md border border-transparent bg-transparent px-2 text-slate-900 hover:border-slate-300 focus-visible:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:h-8 dark:text-slate-100 dark:hover:border-slate-700 dark:focus-visible:border-slate-700',
  FIELD_TEXT,
);
const META_LABEL = 'text-sm text-slate-600 dark:text-slate-400';
/** The act's text, read or written: one sheet, the same measure and padding either way, so the switch moves nothing. */
const SHEET_TEXT = 'mx-auto block w-full max-w-measure px-6 py-8 font-serif text-[17px] leading-[1.7] text-slate-900 md:px-10 md:py-10 dark:text-slate-100';


/**
 * An act of a dossier (`/work/atti/:id`), to read first (Luca, 15-11: the act is written in Word or WordCraft, LexCraft is
 * where it is read and checked): the title, one quiet line with kind · dossier · state, the text as a sheet in the reading
 * serif (its bar: «Modifica il testo», «Analizza l’atto»), and beside it, from `@3xl`, «Citazioni»: the norms and
 * decisions the text cites, each checked at its source (LC46). With a dossier, its sources, notes and other acts stand
 * in a column on the left once the frame holds three columns (`@[62rem]`, so the text keeps its width); below, «Fonti
 * della pratica» opens them in a sheet (LC29, Luca: no form dump). «Modifica il testo» opens the text to a correction, which saves itself
 * `SAVE_DELAY_MS` after the last change («Cita» then writes a source where the cursor is). Title, kind, dossier and state
 * save the same way. The rare actions sit in the «⋯» menu: a new version from its file (after a confirmation), copy,
 * download, and «Elimina l’atto», red there only, which asks first.
 */
export function AttoEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: new Date() });
  const [dossiers, setDossiers] = useState<DossierApi[]>([]);
  const [items, setItems] = useState<DossierApi['items']>([]);
  const [siblings, setSiblings] = useState<AttoSummary[]>([]);
  const [fontiOpen, setFontiOpen] = useState(false);
  const fontiButton = useRef<HTMLButtonElement>(null);
  // Where the focus goes as the sources' sheet closes: its button, or the text after a «Cita».
  const sheetReturn = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  // The linked dossier's entries (norms, decisions, notes) in its order, and its other acts.
  const dossierId = draft?.dossierId ?? null;
  useEffect(() => {
    let alive = true;
    // No dossier: the column is not drawn, and what it held waits for the next one.
    if (!dossierId) return undefined;
    dossierService
      .getById(dossierId)
      .then((dossier) => alive && setItems(dossier.items))
      .catch(() => alive && setItems([]));
    attiService
      .list(dossierId)
      .then((list) => alive && setSiblings(list.filter((atto) => atto.id !== id)))
      .catch(() => alive && setSiblings([]));
    return () => {
      alive = false;
    };
  }, [dossierId, id]);

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
      notify({ type: 'success', message: 'Testo copiato.', duration: 2000 });
    } catch {
      notify({ type: 'error', message: 'Il testo non è stato copiato.', duration: 4000 });
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
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* The way back, then how the act stands and its other actions; clear of the full-screen button (D-253). */}
      <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2', FOCUS_BUTTON_CLEARANCE)}>
        {back}
        <div className="flex items-center gap-2">
          <p role="status" className={cn('flex items-center gap-2 text-sm', save.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'text-slate-600 dark:text-slate-400')}>
            {saveWords}
            {save.kind === 'error' && <Button size="sm" variant="secondary" onClick={() => void flush()}>Riprova</Button>}
          </p>
          {/* The rare actions in one menu; «Elimina» last, red there only, and it asks first. */}
          <MenuButton
            label="Altre azioni sull’atto"
            title="Altre azioni"
            triggerClassName="h-11 w-11 justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:h-8 md:w-8 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            items={[
              { label: 'Carica una nuova versione', icon: FileUp, onSelect: () => fileInput.current?.click() },
              { label: 'Copia il testo', icon: Copy, onSelect: () => void copy() },
              { label: 'Scarica in .txt', icon: Download, onSelect: download },
              { label: 'Elimina l’atto', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => setConfirmDelete(true) },
            ]}
          >
            <MoreHorizontal aria-hidden size={18} />
          </MenuButton>
        </div>
      </div>
      {/* Out of the menu, which is gone once closed: the input outlives the click that opens it. */}
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

      <div className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="atto-titolo">Titolo dell’atto</label>
        <input
          id="atto-titolo"
          value={draft.titolo}
          onChange={(e) => change({ titolo: e.target.value })}
          onBlur={() => void flush()}
          maxLength={300}
          className="w-full border-b border-transparent bg-transparent pb-1 font-serif text-[28px] font-medium leading-tight tracking-tight text-slate-900 hover:border-slate-200 focus-visible:border-slate-400 focus-visible:outline-none md:text-3xl dark:text-slate-50 dark:hover:border-slate-800"
        />
        {/* One quiet line: kind · dossier · state, each editable where it stands. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label className="flex items-center gap-1">
            <span className={META_LABEL}>Tipo</span>
            <input value={draft.tipo ?? ''} placeholder="Nessuno" onChange={(e) => change({ tipo: e.target.value.trim() ? e.target.value : null })} list="atto-tipi" maxLength={100} size={Math.max((draft.tipo ?? '').length, 9)} className={cn(META_FIELD, 'min-w-24 placeholder:text-slate-500 [field-sizing:content]')} />
            <datalist id="atto-tipi">{ATTO_TIPI.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          <span aria-hidden className="-mx-1 text-slate-400 dark:text-slate-600">·</span>
          <label className="flex items-center gap-1">
            <span className={META_LABEL}>Dossier</span>
            <select value={draft.dossierId ?? ''} onChange={(e) => change({ dossierId: e.target.value || null })} className={cn(META_FIELD, 'max-w-60 bg-card [field-sizing:content]')}>
              <option value="">Nessuno</option>
              {dossiers.filter((d) => d.kind !== 'studio' || d.id === draft.dossierId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <span aria-hidden className="-mx-1 text-slate-400 dark:text-slate-600">·</span>
          <div role="radiogroup" aria-label="Stato" className="flex h-11 items-center gap-0.5 rounded-md bg-slate-100 p-0.5 md:h-8 dark:bg-slate-800">
            {(['bozza', 'finale'] as AttoStato[]).map((stato) => (
              <button
                key={stato}
                type="button"
                role="radio"
                aria-checked={draft.stato === stato}
                onClick={() => change({ stato })}
                className={cn('h-full rounded px-3 text-sm', FOCUS_RING, draft.stato === stato ? 'bg-card font-medium text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100')}
              >
                {stato === 'bozza' ? 'Bozza' : 'Finale'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {deleteError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{deleteError}</p>}
      {fileError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{fileError}</p>}

      {/* Container queries, not the window's: the frame stops at 66 rem, so the window says little of the room the columns have. */}
      <div className="@container">
        <div className={cn('grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,48rem)_15rem] @3xl:gap-10', draft.dossierId && '@[62rem]:grid-cols-[13rem_minmax(0,48rem)_15rem] @[62rem]:gap-8')}>
          {draft.dossierId && (
            <aside aria-labelledby="atto-fonti" className="hidden flex-col gap-3 @[62rem]:sticky @[62rem]:top-4 @[62rem]:flex @[62rem]:self-start">
              <h2 id="atto-fonti" className="text-sm font-medium text-slate-700 dark:text-slate-300">Fonti della pratica</h2>
              <AttoFonti items={items} atti={siblings} editing={editing} onCite={cite} />
              <Link to={`/dossier?dossier=${encodeURIComponent(draft.dossierId)}`} className={cn('mt-1 w-fit rounded-sm text-sm text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-slate-100', FOCUS_RING)}>Apri il dossier</Link>
            </aside>
          )}
          {/* The sheet: its bar on top (correct the text, the practice's sources, analyse it), then the text in the reading serif. */}
          <div className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-card shadow-sm has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-primary-500 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="quiet" size="sm" icon={<Pencil size={15} aria-hidden />} onClick={() => setEditing((now) => !now)} aria-pressed={editing}>
                  {editing ? 'Fine modifica' : 'Modifica il testo'}
                </Button>
                {/* Where the column does not fit, the same sources open in a sheet. */}
                {draft.dossierId && (
                  <Button
                    ref={fontiButton}
                    variant="quiet"
                    size="sm"
                    className="@[62rem]:hidden"
                    onClick={() => {
                      sheetReturn.current = fontiButton.current;
                      setFontiOpen(true);
                    }}
                  >
                    Fonti della pratica
                  </Button>
                )}
                {/* Where «Citazioni» sits under the whole text (Papiniano: on a phone it is far away), a way to it. */}
                <Button
                  variant="quiet"
                  size="sm"
                  className="@3xl:hidden"
                  onClick={() => {
                    const heading = document.getElementById('atto-citazioni');
                    heading?.scrollIntoView({ block: 'start' });
                    heading?.focus({ preventScroll: true });
                  }}
                >
                  Vai alle citazioni
                </Button>
              </div>
              {/* «Analizza documento» in the act's flow (Luca, 15-11): the citations found, linked to their norms and decisions. */}
              <Button
                variant="secondary"
                size="sm"
                disabled={!draft.testo.trim()}
                onClick={() => {
                  void flush();
                  navigate('/documents', { state: { atto: { id, titolo: draft.titolo, testo: draft.testo } } });
                }}
              >
                Analizza l’atto
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
                className={cn(SHEET_TEXT, 'min-h-[60vh] resize-none bg-transparent [field-sizing:content] placeholder:text-slate-500 focus-visible:outline-none')}
              />
              {near && <p className="border-t border-slate-200 px-4 py-2 text-xs text-amber-800 dark:border-slate-800 dark:text-amber-300">{draft.testo.length.toLocaleString('it-IT')} caratteri su {MAX_TESTO.toLocaleString('it-IT')}.</p>}
            </>) : (
              <article aria-label="Testo dell’atto" className={cn(SHEET_TEXT, 'min-h-[40vh]')}>
                {draft.testo.trim()
                  // As written, line for line: the same lines as in «Modifica il testo», so the switch moves nothing.
                  ? <div className="whitespace-pre-wrap">{draft.testo}</div>
                  : <p className="text-slate-600 dark:text-slate-400">L’atto non ha ancora un testo. Scrivilo con «Modifica il testo», o caricane una versione dal file con il menu ⋯.</p>}
              </article>
            )}
          </div>
          <AttoCitazioni testo={draft.testo} className="@3xl:sticky @3xl:top-4 @3xl:max-h-[calc(100dvh-2rem)] @3xl:self-start @3xl:overflow-y-auto" />
        </div>
      </div>
      {fontiOpen && draft.dossierId && (
        <Sheet title="Fonti della pratica" onClose={() => setFontiOpen(false)} closeOnEscape closeOnBackdrop returnFocusRef={sheetReturn}>
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
            <AttoFonti
              items={items}
              atti={siblings}
              editing={editing}
              onCite={(text) => {
                // The focus goes back to the text, where the source was written.
                sheetReturn.current = textRef.current;
                setFontiOpen(false);
                cite(text);
              }}
            />
            <Link to={`/dossier?dossier=${encodeURIComponent(draft.dossierId)}`} className={cn('w-fit rounded-sm text-sm text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-slate-100', FOCUS_RING)}>Apri il dossier</Link>
          </div>
        </Sheet>
      )}

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
