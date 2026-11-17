import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bold, List } from 'lucide-react';
import { Button } from '../../ui/Button';
import { MAX_ISTRUZIONI, praticaFilesError, praticaFilesService } from '../../../services/praticaFilesService';
import { SAVE_DELAY_MS } from './attiText';

/**
 * The case's instructions for Claude (LC53, spec §12): Markdown, written by hand or with two buttons, saved by
 * itself a moment after the last keystroke. The box appears once the saved text is read, so typing never races it.
 */
export function IstruzioniPerClaude({ dossierId, headingClass }: { dossierId: string; headingClass: string }) {
  const headingId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [testo, setTesto] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    praticaFilesService.getIstruzioni(dossierId).then(
      (saved) => alive && setTesto(saved),
      (failure) => alive && setLoadError(praticaFilesError(failure, 'Non è stato possibile leggere le istruzioni.')),
    );
    return () => {
      alive = false;
    };
  }, [dossierId, reload]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    setStatus('saving');
    praticaFilesService.saveIstruzioni(dossierId, text).then(
      () => setStatus(pending.current === null ? 'saved' : 'idle'),
      (failure) => {
        setStatus('idle');
        setSaveError(praticaFilesError(failure, 'Le istruzioni non sono state salvate. Riprova.'));
      },
    );
  }, [dossierId]);

  // Leaving the dossier inside the wait saves what was typed.
  useEffect(() => flush, [flush]);

  const change = (next: string) => {
    setTesto(next);
    setSaveError(null);
    setStatus('idle');
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  /** Replaces the selection, then selects `[from, to)` of the new text. */
  const edit = (next: string, from: number, to: number) => {
    change(next);
    const el = box.current;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from, to);
    });
  };

  const bold = () => {
    const el = box.current;
    if (!el) return;
    const { value, selectionStart: start, selectionEnd: end } = el;
    const words = value.slice(start, end) || 'testo';
    edit(`${value.slice(0, start)}**${words}**${value.slice(end)}`, start + 2, start + 2 + words.length);
  };

  const bullets = () => {
    const el = box.current;
    if (!el) return;
    const { value, selectionStart, selectionEnd: end } = el;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lines = value.slice(start, end).split('\n').map((line) => (line.startsWith('- ') ? line : `- ${line}`)).join('\n');
    const next = value.slice(0, start) + lines + value.slice(end);
    edit(next, start + lines.length, start + lines.length);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className={headingClass}>Istruzioni per Claude</h3>
      <p className="text-[15px] text-slate-600 dark:text-slate-400">Claude le legge per prime quando lavora su questa pratica.</p>
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
          {loadError}
          <Button variant="secondary" size="sm" onClick={() => { setLoadError(null); setReload((n) => n + 1); }}>Riprova</Button>
        </div>
      ) : testo === null ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Caricamento…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Bold size={14} aria-hidden />} onClick={bold}>Grassetto</Button>
            <Button variant="secondary" size="sm" icon={<List size={14} aria-hidden />} onClick={bullets}>Elenco</Button>
            <span role="status" className="ml-auto text-sm text-slate-600 dark:text-slate-400">
              {status === 'saving' ? 'Salvataggio…' : status === 'saved' ? 'Salvato' : ''}
            </span>
          </div>
          <textarea
            ref={box}
            aria-labelledby={headingId}
            value={testo}
            onChange={(event) => change(event.target.value)}
            maxLength={MAX_ISTRUZIONI}
            rows={6}
            placeholder="Per esempio: cosa fare, quali fonti citare, con quali atti coordinarsi."
            className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-base leading-relaxed text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-100"
          />
          {saveError && <p role="alert" className="text-[15px] text-red-700 dark:text-red-400">{saveError}</p>}
        </>
      )}
    </section>
  );
}
