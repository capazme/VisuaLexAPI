import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { dossierService, type DossierSnapshotApi } from '../../../services/dossierService';
import { Expand } from '../../ui/Expand';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { formatTimestampLong } from './dossierUtils';
import { CHANGE_WORDS, changesLine, compareSnapshots, type ItemChange, type ItemChangeKind } from './dossierVersionsDiff';

interface Props {
  dossierId: string;
  open: boolean;
  /** Changes when a snapshot is saved: an open comparison reads the list again. */
  refreshKey?: string;
  onClose: () => void;
  className?: string;
}

const KIND_STYLE: Record<ItemChangeKind, string> = {
  entrata: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  uscita: 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  cambiata: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

// The label «Verifica dd/mm/yyyy» already says the day: the date only for a snapshot with none, or a phone cuts it.
const versionName = (s: DossierSnapshotApi) => `v${s.version} · ${s.label || formatTimestampLong(s.createdAt)}`;

/**
 * Two snapshots of the dossier compared in the page (LC121, L-73): entries that came, went and changed, a note's
 * changed words marked. The browser computes it from the snapshots' content.
 */
export function DossierVersionsCompare({ dossierId, open, refreshKey, onClose, className }: Props) {
  const headingId = useId();
  const [snapshots, setSnapshots] = useState<DossierSnapshotApi[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');

  // Read again at each opening and at each new snapshot: one just saved came back from the POST without its content.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    dossierService.getSnapshots(dossierId)
      .then((list) => {
        if (cancelled) return;
        setFailed(false);
        setSnapshots(list);
        setToId(list[0]?.id ?? '');
        setFromId(list[1]?.id ?? '');
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, dossierId, refreshKey]);

  const changes = useMemo(() => {
    const from = snapshots?.find((s) => s.id === fromId);
    const to = snapshots?.find((s) => s.id === toId);
    return from && to ? compareSnapshots(from.content?.items ?? [], to.content?.items ?? []) : null;
  }, [snapshots, fromId, toId]);

  return (
    // Opens once the list is here: drawn while loading, the space grew for «Leggo…» and jumped when the data came.
    <Expand open={open && (snapshots !== null || failed)} onClose={onClose} role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      <div className="space-y-4 p-4 md:p-5">
        <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-slate-50">Confronta due versioni</h2>
        {failed ? (
          <p className="text-sm text-red-700 dark:text-red-400">Non riesco a leggere gli snapshot della pratica. Riprova più tardi.</p>
        ) : snapshots === null ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Leggo gli snapshot…</p>
        ) : snapshots.length < 2 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Servono almeno due snapshot: salvane uno da «Esporta», poi un altro dopo le modifiche.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Da" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {snapshots.map((s) => <option key={s.id} value={s.id}>{versionName(s)}</option>)}
              </Select>
              <Select label="A" value={toId} onChange={(e) => setToId(e.target.value)}>
                {snapshots.map((s) => <option key={s.id} value={s.id}>{versionName(s)}</option>)}
              </Select>
            </div>
            {changes && (
              <>
                <p role="status" className="text-sm font-medium text-slate-800 dark:text-slate-200">{changesLine(changes)}</p>
                {changes.length > 0 && (
                  <ul aria-label="Differenze" className="divide-y divide-slate-100 dark:divide-slate-800">
                    {changes.map((change) => <ChangeRow key={`${change.kind}-${change.id}`} change={change} />)}
                  </ul>
                )}
              </>
            )}
          </>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Chiudi</Button>
        </div>
      </div>
    </Expand>
  );
}

function ChangeRow({ change }: { change: ItemChange }) {
  return (
    <li className="space-y-1 py-2">
      <p className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className={cn('rounded-[4px] px-1.5 py-0.5 text-xs font-semibold', KIND_STYLE[change.kind])}>{CHANGE_WORDS[change.kind]}</span>
        <span className="text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{change.label}</span>
      </p>
      {/* Every note is titled «Nota»: a note that came or went is told by its text. */}
      {change.text !== undefined && (
        <p className="text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">{change.text}</p>
      )}
      {change.words && (
        <p className="text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
          {change.words.map((part, i) =>
            part.added ? (
              <ins key={i} className="rounded-[4px] bg-emerald-100 dark:bg-emerald-900/40"><span className="sr-only">aggiunto: </span>{part.value}</ins>
            ) : part.removed ? (
              // A word that went and the one that came in its place touch: a space between them.
              <Fragment key={i}><del className="rounded-[4px] bg-red-100 dark:bg-red-900/40"><span className="sr-only">tolto: </span>{part.value}</del>{change.words![i + 1]?.added && !/\s$/.test(part.value) ? ' ' : null}</Fragment>
            ) : (
              <span key={i}>{part.value}</span>
            ),
          )}
        </p>
      )}
    </li>
  );
}
