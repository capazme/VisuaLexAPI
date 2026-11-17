import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Download, FilePlus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { cn } from '../../../lib/utils';
import { saveBlob } from '../../../utils/saveBlob';
import {
  FILES_OFF_MESSAGE,
  MAX_FILE_BYTES,
  PRATICA_FILE_ACCEPT,
  praticaFilesError,
  praticaFilesService,
  type PraticaFile,
  type PraticaFiles,
} from '../../../services/praticaFilesService';
import { changedOn, kindOf, weight } from './attiText';

/** Seen once per person on this browser (a `user` key in `sessionEnd.ts`: a sign-out shows it again). */
const NOTICE_KEY = 'visualex.atti.avviso-visto';

const noticeSeen = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
};

const rememberNotice = () => {
  try {
    localStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // Without storage the notice shows again next time: the safe way.
  }
};

/** Proposal «Atti della pratica», point 8 (text corrected after the consultant), and the test line of the brief. */
const NOTICE =
  "I file che carichi restano sul server di LexCraft, cifrati. Nell'app li vedi solo tu; chi gestisce il server, se serve, può accedervi. Se li fai leggere a Claude, il loro testo arriva al modello che usi. È una prova: non caricare atti veri di clienti.";

/** The original's last change, or its newest version's: the list puts it first. */
const lastChange = (group: PraticaFiles['files'][number]) =>
  Math.max(Date.parse(group.updatedAt), ...group.versioni.map((v) => Date.parse(v.createdAt)));

const byWhom = (file: PraticaFile, feminine: boolean) =>
  file.autore === 'claude' ? (feminine ? 'scritta da Claude' : 'scritto da Claude') : feminine ? 'caricata da te' : 'caricato da te';

/**
 * The case's files (LC53, spec §12): the originals, the last changed first, each with its versions under it, and the
 * case's trash; then «Carica un file», with the notice before the first upload.
 */
export function PraticaFilesPanel({ dossierId, headingClass, onCount }: { dossierId: string; headingClass: string; onCount?: (count: number) => void }) {
  const filesHeading = useId();
  const uploadHeading = useId();
  const input = useRef<HTMLInputElement>(null);
  const versionOf = useRef<string | undefined>(undefined);
  const [data, setData] = useState<PraticaFiles | null>(null);
  const [listError, setListError] = useState<{ message: string; off: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const [pending, setPending] = useState<{ file: File; versionOf?: string } | null>(null);
  const [toDelete, setToDelete] = useState<PraticaFile | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let alive = true;
    praticaFilesService.list(dossierId).then(
      (answer) => {
        if (!alive) return;
        setData(answer);
        setListError(null);
        onCount?.(answer.files.length);
      },
      (failure) => {
        if (!alive) return;
        const message = praticaFilesError(failure, 'Non è stato possibile leggere i file della pratica.');
        setListError({ message, off: message === FILES_OFF_MESSAGE });
      },
    );
    return () => {
      alive = false;
    };
  }, [dossierId, reload, onCount]);

  /** Runs an action on the files, then reads them again; its failure is said in the page. */
  const run = async (action: () => Promise<unknown>, fallback: string, success = '') => {
    setActionError(null);
    setDone('');
    try {
      await action();
      setDone(success);
      setReload((n) => n + 1);
    } catch (failure) {
      setActionError(praticaFilesError(failure, fallback));
    }
  };

  const upload = async (file: File, of?: string) => {
    setBusy(true);
    await run(() => praticaFilesService.upload(dossierId, file, of), 'Il file non è stato caricato. Riprova.', `«${file.name}» caricato.`);
    setBusy(false);
  };

  const take = (file: File | undefined, of?: string) => {
    if (!file) return;
    setActionError(null);
    setDone('');
    // The server reads an empty file's format as unknown: said plainly here instead (tester, 16-11).
    if (file.size === 0) {
      setActionError('Il file è vuoto.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setActionError('Il file supera 25 MB.');
      return;
    }
    if (!noticeSeen()) {
      setPending({ file, versionOf: of });
      return;
    }
    void upload(file, of);
  };

  const choose = (of?: string) => {
    versionOf.current = of;
    input.current?.click();
  };

  const download = (file: PraticaFile) =>
    run(async () => saveBlob(await praticaFilesService.download(dossierId, file.id), file.nome), 'Il file non è stato scaricato. Riprova.');

  // Without the server key nothing can be uploaded (LC61): the button is off and a drop does nothing.
  const filesOff = listError?.off === true;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (filesOff) return;
    take(event.dataTransfer.files?.[0]);
  };

  const groups = data ? [...data.files].sort((a, b) => lastChange(b) - lastChange(a)) : [];

  return (
    <>
      <section aria-labelledby={filesHeading} className="flex flex-col gap-3">
        <h3 id={filesHeading} className={headingClass}>File</h3>
        {actionError && <p role="alert" className="text-[15px] text-red-700 dark:text-red-400">{actionError}</p>}
        <p role="status" className="text-sm text-slate-600 empty:hidden dark:text-slate-400">{done}</p>
        {listError ? (
          listError.off ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">{listError.message}</p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
              {listError.message}
              <Button variant="secondary" size="sm" onClick={() => { setListError(null); setReload((n) => n + 1); }}>Riprova</Button>
            </div>
          )
        ) : data === null ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Caricamento…</p>
        ) : (
          <>
            {groups.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Questa pratica non ha ancora file.</p>
            ) : (
              <ul aria-label="File della pratica" className="border-t border-slate-200 dark:border-slate-800">
                {groups.map((group) => (
                  <li key={group.id} className="flex flex-col gap-2 border-b border-slate-200 py-3 dark:border-slate-800">
                    <span className="min-w-0">
                      <span className="block break-words font-serif text-lg text-slate-900 dark:text-slate-50">{group.nome}</span>
                      <span className="block text-sm text-slate-600 dark:text-slate-400">
                        {`${kindOf(group.mime)} · ${weight(group.peso)} · ${byWhom(group, false)} il ${changedOn(group.createdAt)}`}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" icon={<Download size={14} aria-hidden />} aria-label={`Scarica ${group.nome}`} onClick={() => void download(group)}>Scarica</Button>
                      <Button variant="secondary" size="sm" icon={<FilePlus size={14} aria-hidden />} aria-label={`Carica una versione nuova di ${group.nome}`} disabled={busy} onClick={() => choose(group.id)}>Carica una versione nuova</Button>
                      <Button variant="secondary" size="sm" icon={<Trash2 size={14} aria-hidden />} aria-label={`Sposta nel cestino ${group.nome}`} onClick={() => void run(() => praticaFilesService.trash(dossierId, group.id), 'Il file non è stato spostato nel cestino. Riprova.', `«${group.nome}» è nel cestino della pratica.`)}>Sposta nel cestino</Button>
                    </span>
                    {group.versioni.length > 0 && (
                      <ul aria-label={`Versioni di ${group.nome}`} className="ml-4 flex flex-col gap-3 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
                        {group.versioni.map((version) => (
                          <li key={version.id} className="flex flex-col gap-2">
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                {`versione ${version.versione}, ${byWhom(version, true)}, il ${changedOn(version.createdAt)}`}
                              </span>
                              <span className="block break-words text-sm text-slate-600 dark:text-slate-400">{`${version.nome} · ${kindOf(version.mime)} · ${weight(version.peso)}`}</span>
                            </span>
                            <span className="flex flex-wrap gap-2">
                              <Button variant="secondary" size="sm" icon={<Download size={14} aria-hidden />} aria-label={`Scarica ${version.nome}, versione ${version.versione}`} onClick={() => void download(version)}>Scarica</Button>
                              <Button variant="secondary" size="sm" icon={<Trash2 size={14} aria-hidden />} aria-label={`Sposta nel cestino ${version.nome}, versione ${version.versione}`} onClick={() => void run(() => praticaFilesService.trash(dossierId, version.id), 'Il file non è stato spostato nel cestino. Riprova.', `La versione ${version.versione} è nel cestino della pratica.`)}>Sposta nel cestino</Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data.cestino.length > 0 && (
              <div className="flex flex-col gap-2 pt-2">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cestino della pratica</h4>
                <ul aria-label="Cestino della pratica" className="flex flex-col gap-2">
                  {data.cestino.map((file) => (
                    <li key={file.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 break-words text-sm text-slate-700 dark:text-slate-300">
                        {file.versioneDi ? `${file.nome}, versione ${file.versione}` : file.nome}
                      </span>
                      <Button variant="secondary" size="sm" icon={<RotateCcw size={14} aria-hidden />} aria-label={`Ripristina ${file.nome}`} onClick={() => void run(() => praticaFilesService.restore(dossierId, file.id), 'Il file non è stato ripristinato. Riprova.', `«${file.nome}» è di nuovo tra i file.`)}>Ripristina</Button>
                      <Button variant="secondary" size="sm" icon={<X size={14} aria-hidden />} aria-label={`Elimina ${file.nome}`} onClick={() => setToDelete(file)}>Elimina</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby={uploadHeading} className="flex flex-col gap-2">
        <h3 id={uploadHeading} className={headingClass}>Carica un file</h3>
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4',
            dragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-950' : 'border-slate-300 dark:border-slate-700',
          )}
        >
          <Button icon={<Upload size={16} aria-hidden />} loading={busy} disabled={filesOff} onClick={() => choose()}>Carica un file</Button>
          {!filesOff && <span className="text-sm text-slate-600 max-md:hidden dark:text-slate-400">oppure trascinalo qui.</span>}
          <input
            ref={input}
            type="file"
            accept={PRATICA_FILE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              take(event.target.files?.[0], versionOf.current);
              versionOf.current = undefined;
              event.target.value = '';
            }}
          />
        </div>
        <p className="text-[15px] text-slate-600 dark:text-slate-400">Fino a 25 MB per file. PDF, Word, ODT, RTF, TXT, JPG, PNG.</p>
      </section>

      <ConfirmDialog
        open={pending !== null}
        title="Prima di caricare il primo file"
        message={NOTICE}
        confirmLabel="Ho capito, carica"
        focusCancel
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const next = pending;
          setPending(null);
          rememberNotice();
          if (next) void upload(next.file, next.versionOf);
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        variant="danger"
        title="Eliminare il file?"
        message={toDelete?.versioneDi ? 'La versione esce dalla pratica. Non si può annullare.' : 'Il file e le sue versioni escono dalla pratica. Non si può annullare.'}
        confirmLabel="Elimina"
        focusCancel
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const file = toDelete;
          setToDelete(null);
          if (file) void run(() => praticaFilesService.remove(dossierId, file.id), 'Il file non è stato eliminato. Riprova.', `«${file.nome}» eliminato.`);
        }}
      />
    </>
  );
}
