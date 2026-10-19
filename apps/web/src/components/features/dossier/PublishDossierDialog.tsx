import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert, Upload } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { Dossier, EnvironmentCategory, SharedEnvironmentContent } from '../../../types';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { getErrorMessage } from '../../../utils/errors';
import { FORUM_CATEGORIES } from '../../../utils/forumCategories';
import { PERSONAL_DATA_LABELS, findPersonalData, splitPersonalData } from '../../../utils/personalDataPatterns';
import type { PdfMarks } from './dossierPdf';
import { buildPublication, defaultIncluded, ticksFromPublished, withFields, type PublicationRow } from './dossierPublication';
import { loadPublicationMarks } from './publicationMarks';

interface Props {
  dossier: Dossier;
  /** The user's other dossiers: a note on an article also in a dossier di lavoro is marked. */
  otherDossiers: Dossier[];
  onClose: () => void;
  /** After the server took it: the dossier is read again so its header says it is published. */
  onPublished: (message: string) => void;
  /** The server says the dossier is already in the Forum: it is read again, and the dialog becomes an update. */
  onAlreadyPublished: () => void;
}

const NO_MARKS: ReadonlyMap<string, PdfMarks> = new Map();
const TITLE_MIN = 3;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;
const TAGS_MAX = 10;
const TAG_MAX = 30;

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const LINK_BUTTON = `rounded px-2 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${TOUCH_TARGET_RESPONSIVE}`;

// The owner's wording (14 October 2026, question 186), with his added sentence on manuals.
const WARNING = [
  'Chiunque abbia un account VisuaLex potrà leggerlo e scaricarne una copia: il titolo, la descrizione, le voci, le note e le evidenziazioni spuntate qui sopra, con il tuo nome utente.',
  'Le note appartengono all’articolo, non al dossier: controlla anche quelle scritte per altre pratiche.',
  'Non pubblicare dati personali dei clienti o di altre persone, né fatti di una pratica che le rendano riconoscibili.',
  'Non copiare testi di manuali o commentari.',
  'Se ritiri il dossier, chi l’ha già scaricato ne conserva la copia.',
];

/** A text with the personal data the machine found marked, every character kept (plain text, never HTML). */
function Flagged({ text }: { text: string }) {
  return (
    <>
      {splitPersonalData(text).map((piece, i) => piece.kind ? (
        <mark key={i} className="rounded bg-amber-200 px-0.5 text-amber-950 dark:bg-amber-700/60 dark:text-amber-50" title={`Possibile dato personale: ${PERSONAL_DATA_LABELS[piece.kind]}`}>
          {piece.text}
        </mark>
      ) : <span key={i}>{piece.text}</span>)}
    </>
  );
}

function fieldFlags(text: string): string | null {
  const kinds = [...new Set(findPersonalData(text).map((s) => PERSONAL_DATA_LABELS[s.kind]))];
  return kinds.length ? `Possibile dato personale: ${kinds.join(', ')}` : null;
}

type Load = { status: 'loading' } | { status: 'ready'; marks: Map<string, PdfMarks>; leftOut: string | null } | { status: 'error' };

/**
 * «Pubblica nel Forum» from the dossier, in one dialog (spec 2026-10-13-environments-into-forum, D3–D5): the
 * fields, the preview of exactly what becomes public, the privacy check. Also «Aggiorna la versione pubblicata»,
 * the same dialog over the copy already in the Forum.
 */
export function PublishDossierDialog({ dossier, otherDossiers, onClose, onPublished, onAlreadyPublished }: Props) {
  const updating = dossier.published ?? null;
  const updatingId = updating?.sharedEnvironmentId ?? null;
  const [title, setTitle] = useState(dossier.title.slice(0, TITLE_MAX));
  const [description, setDescription] = useState((dossier.description ?? '').slice(0, DESCRIPTION_MAX));
  const [category, setCategory] = useState<EnvironmentCategory>('other');
  const [tagsInput, setTagsInput] = useState((dossier.tags ?? []).slice(0, TAGS_MAX).join(', '));
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [included, setIncluded] = useState<Set<string> | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyUnread, setCopyUnread] = useState(false);
  // An update's starting ticks are the published copy's: `undefined` while it is read, `null` when it could not be.
  const [publishedCopy, setPublishedCopy] = useState<SharedEnvironmentContent | null | undefined>(undefined);
  // Fields the user changed: the published copy's values never overwrite them.
  const touched = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // The items as the dialog opened: the dossier is read again every minute (`useDossierRefresh`), and
  // the marks are read once, not two requests per entry each time.
  const openedItems = useRef(dossier.items);

  useEffect(() => {
    let alive = true;
    loadPublicationMarks(openedItems.current)
      .then(({ marks, leftOut }) => { if (alive) setLoad({ status: 'ready', marks, leftOut }); })
      .catch((err) => {
        console.error('Publish: marks could not be read', err);
        if (alive) setLoad({ status: 'error' });
      });
    return () => { alive = false; };
  }, []);

  // An update starts from what the Forum holds: its name, description, category and tags; once.
  useEffect(() => {
    if (!updatingId) return;
    let alive = true;
    sharedEnvironmentService.getById(updatingId)
      .then((env) => {
        if (!alive) return;
        setPublishedCopy(env.content ?? null);
        if (!env.content) setCopyUnread(true);
        if (touched.current) return;
        setTitle(env.title);
        setDescription(env.description ?? '');
        setCategory(env.category);
        setTagsInput((env.tags ?? []).join(', '));
      })
      .catch((err) => {
        console.error('Publish: the published copy could not be read', err);
        if (alive) {
          setCopyUnread(true);
          setPublishedCopy(null);
        }
      });
    return () => { alive = false; };
  }, [updatingId]);

  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    touched.current = true;
    set(value);
  };

  const tags = useMemo(() => tagsInput.split(',').map((t) => t.trim()).filter(Boolean), [tagsInput]);
  // The rows do not depend on the fields: the checks over every note run when the ticks change, not at each key.
  const publication = useMemo(
    () => buildPublication(dossier, load.status === 'ready' ? load.marks : NO_MARKS, otherDossiers, { title: '', description: '', tags: [] }, included),
    [dossier, load, otherDossiers, included],
  );
  // `buildPublication` with `null` sends the defaults: an update's starting ticks are resolved here, once the rows exist.
  const sendable = useMemo(
    () => (included || !updatingId ? publication : buildPublication(dossier, load.status === 'ready' ? load.marks : NO_MARKS, otherDossiers, { title: '', description: '', tags: [] }, ticksFromPublished(publication.rows, publishedCopy ?? null))),
    [publication, included, updatingId, dossier, load, otherDossiers, publishedCopy],
  );
  // An update starts from what the Forum holds (nothing but the entries when it could not be read); a publication
  // from the defaults (highlights ticked, notes not).
  const startingTicks = updatingId ? ticksFromPublished(publication.rows, publishedCopy ?? null) : defaultIncluded(publication.rows);
  const ticked = included ?? startingTicks;
  const notes = publication.rows.filter((r) => r.kind === 'note' || r.kind === 'noteEntry');
  const highlights = publication.rows.filter((r) => r.kind === 'highlight');
  const entries = publication.rows.filter((r) => r.kind === 'entry');
  const flaggedRows = publication.rows.filter((r) => r.personalData > 0 && ticked.has(r.id)).length;

  const titleError = title.trim().length < TITLE_MIN ? `Il titolo deve avere almeno ${TITLE_MIN} caratteri.` : null;
  const tagsError = tags.length > TAGS_MAX || tags.some((t) => t.length > TAG_MAX) ? `Al massimo ${TAGS_MAX} tag, di ${TAG_MAX} caratteri.` : null;
  const copyRead = !updatingId || publishedCopy !== undefined;
  const canPublish = load.status === 'ready' && copyRead && checked && !titleError && !tagsError && !busy && entries.length > 0;

  const setTicks = (rows: PublicationRow[], on: boolean) => setIncluded((prev) => {
    const next = new Set(prev ?? startingTicks);
    for (const row of rows) {
      if (on) next.add(row.id);
      else next.delete(row.id);
    }
    return next;
  });
  const toggle = (row: PublicationRow, on: boolean) => setTicks([row], on);
  const setGroup = setTicks;

  const submit = async () => {
    if (!canPublish) return;
    setBusy(true);
    setError(null);
    const content = withFields(sendable.content, { title: title.trim(), description, tags });
    try {
      if (updatingId) {
        // An emptied description is cleared (null), never left as it was in the Forum.
        await sharedEnvironmentService.updateWithVersion(updatingId, {
          title: title.trim(), description: description.trim() || null, category, tags, content,
        });
        onPublished('Versione pubblicata aggiornata');
      } else {
        await sharedEnvironmentService.publish({
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          tags,
          content,
          includeNotes: sendable.includeNotes,
          includeHighlights: sendable.includeHighlights,
          sourceDossierId: dossier.id,
        });
        onPublished('Dossier pubblicato nel Forum');
      }
    } catch (err) {
      setError(getErrorMessage(err) || 'Pubblicazione non riuscita. Riprova.');
      setBusy(false);
      // Already in the Forum (another tab, a double click): read the dossier again, the dialog becomes an update.
      if ((err as { status?: number } | null)?.status === 409) onAlreadyPublished();
    }
  };

  const titleFlag = fieldFlags(title);
  const descriptionFlag = fieldFlags(description);
  const tagsFlag = fieldFlags(tagsInput);

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={updating ? 'Aggiorna la versione pubblicata' : 'Pubblica nel Forum'}
      icon={<Upload size={20} />}
      size="lg"
      closeOnBackdrop={false}
      initialFocusRef={titleRef}
      footer={(
        <>
          <Button variant="secondary" size="sm" className={TOUCH_TARGET_RESPONSIVE} disabled={busy} onClick={onClose}>
            Annulla
          </Button>
          <Button size="sm" className={TOUCH_TARGET_RESPONSIVE} disabled={!canPublish} loading={busy} onClick={() => void submit()}>
            {updating ? 'Aggiorna' : 'Pubblica'}
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        {copyUnread && (
          <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Non riesco a leggere la versione pubblicata: controlla titolo, descrizione, categoria, tag e quali note ed
            evidenziazioni includere prima di aggiornare.
          </p>
        )}
        <div className="grid gap-3">
          <div>
            <label htmlFor="publish-title" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Titolo nel Forum</label>
            <input id="publish-title" ref={titleRef} value={title} maxLength={TITLE_MAX} onChange={(e) => edit(setTitle)(e.target.value)} className={INPUT} aria-describedby="publish-title-help" />
            <p id="publish-title-help" className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {titleError ?? 'È il nome che vedranno gli altri: non usare il nome di una pratica o di un cliente.'}
            </p>
            {titleFlag && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{titleFlag}</p>}
          </div>
          <div>
            <label htmlFor="publish-description" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Descrizione</label>
            <textarea id="publish-description" value={description} maxLength={DESCRIPTION_MAX} rows={2} onChange={(e) => edit(setDescription)(e.target.value)} className={`${INPUT} resize-none`} />
            {descriptionFlag && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{descriptionFlag}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="publish-category" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Categoria</label>
              <select id="publish-category" value={category} onChange={(e) => edit(setCategory)(e.target.value as EnvironmentCategory)} className={`${INPUT} min-h-[44px] md:min-h-0`}>
                {FORUM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="publish-tags" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Tag (separati da virgola)</label>
              <input id="publish-tags" value={tagsInput} onChange={(e) => edit(setTagsInput)(e.target.value)} className={INPUT} />
              {tagsError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{tagsError}</p>}
              {tagsFlag && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{tagsFlag}</p>}
            </div>
          </div>
        </div>

        <section aria-labelledby="publish-preview">
          <h3 id="publish-preview" className="text-sm font-semibold text-slate-900 dark:text-white">Cosa diventa pubblico</h3>
          {load.status === 'loading' && <p role="status" className="mt-2 text-sm text-slate-500">Leggo le note e le evidenziazioni…</p>}
          {load.status === 'error' && (
            <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">Non riesco a leggere le note e le evidenziazioni. Chiudi e riprova.</p>
          )}
          {load.status === 'ready' && !copyRead && (
            <p role="status" className="mt-2 text-sm text-slate-500">Leggo la versione pubblicata…</p>
          )}
          {load.status === 'ready' && copyRead && (
            <div className="mt-2 space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {entries.length} {entries.length === 1 ? 'voce' : 'voci'} · {notes.filter((r) => ticked.has(r.id)).length} di {notes.length} note · {highlights.filter((r) => ticked.has(r.id)).length} di {highlights.length} evidenziazioni
              </p>
              {flaggedRows > 0 && (
                <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  Il controllo automatico ha trovato possibili dati personali in {flaggedRows} {flaggedRows === 1 ? 'elemento spuntato' : 'elementi spuntati'}: sono evidenziati qui sotto.
                </p>
              )}
              {load.leftOut && <p className="text-sm text-slate-600 dark:text-slate-300">{load.leftOut}</p>}
              {publication.unreadable.length > 0 && (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Note ed evidenziazioni non disponibili al momento per: {publication.unreadable.join('; ')}. Non saranno pubblicate.
                </p>
              )}

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Voci</h4>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
                  {entries.map((row) => <li key={row.id}>{row.label}</li>)}
                </ul>
                {publication.leftOut.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-500">
                    {publication.leftOut.map((l, i) => <li key={i}>Non pubblicabile: {l.label} ({l.reason})</li>)}
                  </ul>
                )}
              </div>

              <RowGroup
                heading="Note"
                hint={updatingId ? 'Partono spuntate le note già pubblicate.' : 'Ogni nota parte esclusa: aggiungila dopo averla riletta.'}
                rows={notes}
                ticked={ticked}
                onToggle={toggle}
                onAll={(on) => setGroup(notes, on)}
              />
              <RowGroup
                heading="Evidenziazioni"
                rows={highlights}
                ticked={ticked}
                onToggle={toggle}
                onAll={(on) => setGroup(highlights, on)}
              />
            </div>
          )}
        </section>

        <section aria-labelledby="publish-warning" className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <h3 id="publish-warning" className="font-semibold">Stai per rendere pubblico questo dossier.</h3>
            {dossier.kind !== 'studio' && <p className="font-medium">È un dossier di lavoro: controlla con attenzione titolo e note.</p>}
            {WARNING.map((line) => <p key={line}>{line}</p>)}
            <label className={`mt-2 flex items-start gap-2 font-medium ${TOUCH_TARGET_RESPONSIVE}`}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" />
              Ho controllato: non contiene dati personali
            </label>
          </div>
        </section>

        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}

function RowGroup({ heading, hint, rows, ticked, onToggle, onAll }: {
  heading: string;
  hint?: string;
  rows: PublicationRow[];
  ticked: ReadonlySet<string>;
  onToggle: (row: PublicationRow, on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</h4>
        <div className="flex gap-1">
          <button type="button" className={LINK_BUTTON} onClick={() => onAll(true)}>Tutte</button>
          <button type="button" className={LINK_BUTTON} onClick={() => onAll(false)}>Nessuna</button>
        </div>
      </div>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <ul className="mt-1 space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <label className={`flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700 ${TOUCH_TARGET_RESPONSIVE}`}>
              <input
                type="checkbox"
                checked={ticked.has(row.id)}
                onChange={(e) => onToggle(row, e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-xs text-slate-500 dark:text-slate-400">{row.label}</span>
                {row.anchorText && (
                  <span className="block text-xs italic text-slate-500 dark:text-slate-400">sul passo «<Flagged text={row.anchorText} />»</span>
                )}
                {row.text && <span className="block whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200"><Flagged text={row.text} /></span>}
                {row.overlap.length > 0 && (
                  <span className="block text-xs font-medium text-amber-700 dark:text-amber-300">
                    Anche nel dossier di lavoro {row.overlap.map((n) => `«${n}»`).join(', ')}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
