import { useEffect, useId, useRef, useState } from 'react';
import { Search, CheckSquare, Square, TreeDeciduous } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { Input } from '../../ui/Input';
import { parseItalianDate } from '../../../utils/dateUtils';
import { resolveAct } from '../../../utils/actUrn';
import { isEuropeanAct } from '../../../utils/versionDisplay';
import { extractArticleIdsFromTree, type TreeNode } from '../../../utils/treeUtils';
import { legalFetch } from '../../../services/legalFetch';
import { Expand } from '../../ui/Expand';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';


interface ActIdentity { tipo_atto: string; data: string; numero_atto: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (articles: { numero: string; urn?: string }[], normInfo: ActIdentity) => void;
  /** Open on this act's index at once ("+ articoli" of a dossier's act block). */
  initialAct?: ActIdentity;
  className?: string;
}

// The act types the form offers; an act opened from a dossier may be another.
const ACT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'codice civile', label: 'Codice Civile' },
  { value: 'codice penale', label: 'Codice Penale' },
  { value: 'codice procedura civile', label: 'Codice Procedura Civile' },
  { value: 'codice procedura penale', label: 'Codice Procedura Penale' },
  { value: 'costituzione', label: 'Costituzione' },
  { value: 'legge', label: 'Legge' },
  { value: 'decreto legislativo', label: 'Decreto Legislativo' },
  { value: 'decreto legge', label: 'Decreto Legge' },
  { value: 'd.p.r.', label: 'D.P.R.' },
  // The Union's acts by year and number (2016 and 679 for the GDPR), read from EUR-Lex.
  { value: 'regolamento ue', label: 'Regolamento UE' },
  { value: 'direttiva ue', label: 'Direttiva UE' },
];

type TreeEntry = string | Record<string, string>;

/**
 * «Importa articoli da norma» in the page (LC125, L-73): a space under the header's «Aggiungi» (`Expand`), never over
 * the content. The focus lands on the space, never in a field; Esc closes it and the focus goes back to the command.
 */
export function TreeNavigatorModal({ open, className, ...rest }: Props) {
  const headingId = useId();
  return (
    <Expand open={open} onClose={rest.onClose} role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      {/* Closed, `Expand` draws nothing: opened again, the form starts afresh (and an act's index is read again). */}
      <TreeNavigatorForm {...rest} headingId={headingId} />
    </Expand>
  );
}

function TreeNavigatorForm({ onClose, onImport, initialAct, headingId }: Omit<Props, 'open' | 'className'> & { headingId: string }) {
  const [actType, setActType] = useState(initialAct?.tipo_atto ?? 'codice civile');
  const [actNumber, setActNumber] = useState(initialAct?.numero_atto ?? '');
  const [actDate, setActDate] = useState(initialAct?.data ?? '');
  // The act as the source resolved it: its day and number are what the items
  // store, never the date as typed ("31-12-2012"), or one act becomes two.
  // The act of the tree on screen, kept as it was searched: editing the form
  // without searching again must not relabel the articles of the tree shown.
  const [resolvedAct, setResolvedAct] = useState<ActIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());

  // Only the latest search may fill the list: an older answer arriving late
  // would otherwise label one act's articles with another's identity.
  const searchRef = useRef(0);

  const fetchTree = async () => {
    const search = ++searchRef.current;
    setLoading(true);
    setError(null);
    // A new search empties the old act's index, so «Importa» never takes its
    // articles under the new act's identity, even if this search fails.
    setTree([]);
    setSelectedArticles(new Set());
    setResolvedAct(null);
    try {
      // Derive the URN the tree endpoint needs, without fetching article text.
      const { urn: urnToUse, norma } = await resolveAct({
        act_type: actType,
        act_number: actNumber || undefined,
        date: actDate ? parseItalianDate(actDate) : undefined,
      });
      const data = norma?.data || parseItalianDate(actDate);
      const identity = {
        tipo_atto: actType,
        // An act of the Union is the year and the number (the source's own answer, and what a
        // search stores): a full day typed here would make it a second act with other keys.
        data: isEuropeanAct(actType) ? data.slice(0, 4) : data,
        numero_atto: norma?.numero_atto || actNumber,
      };

      const treeRes = await legalFetch('/fetch_tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: urnToUse, link: false, details: false }),
      });
      const treeResponse = await treeRes.json();
      if (treeResponse.error) throw new Error(treeResponse.error);

      // /fetch_tree returns { articles: [{allegato, numero}] } (no `tree` key);
      // flatten to deduped article-id strings via the shared util.
      const rawTree = Array.isArray(treeResponse) ? treeResponse : (treeResponse.articles ?? []);
      const treeData = rawTree.filter(
        (node: unknown): node is TreeNode =>
          typeof node === 'string' || (typeof node === 'object' && node !== null)
      );
      if (search !== searchRef.current) return;
      // The tree and the act it belongs to arrive together, or not at all.
      setTree(extractArticleIdsFromTree(treeData));
      setResolvedAct(identity);
    } catch (err) {
      if (search !== searchRef.current) return;
      setError(err instanceof Error ? err.message : 'Errore nel recupero della struttura');
    } finally {
      if (search === searchRef.current) setLoading(false);
    }
  };

  // Opened on an act: its index straight away. Once, on mount; the form stays editable.
  useEffect(() => {
    if (initialAct) void fetchTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleArticle = (articleNum: string) => {
    setSelectedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(articleNum)) next.delete(articleNum);
      else next.add(articleNum);
      return next;
    });
  };

  const allSelected = tree.length > 0 && selectedArticles.size === tree.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedArticles(new Set());
      return;
    }
    const all = tree.map((item) => (typeof item === 'string' ? item : Object.keys(item)[0]));
    setSelectedArticles(new Set(all));
  };

  const runImport = () => {
    const articles = Array.from(selectedArticles).map((num) => {
      const entry = tree.find((t) => (typeof t === 'string' ? t === num : Object.keys(t)[0] === num));
      return {
        numero: num,
        urn: typeof entry === 'object' ? Object.values(entry)[0] : undefined,
      };
    });
    if (!resolvedAct) return;
    onImport(articles, resolvedAct);
    onClose();
  };

  return (
    <div>
        <h2 id={headingId} className="flex items-center gap-2 px-4 pt-4 text-base font-semibold text-slate-900 md:px-5 md:pt-5 dark:text-slate-50">
          <TreeDeciduous size={18} aria-hidden className="text-green-600" />
          Importa articoli da norma
        </h2>

        <div className="space-y-4 p-4 md:p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Select label="Tipo atto" value={actType} onChange={(e) => setActType(e.target.value)}>
                {!ACT_TYPE_OPTIONS.some((o) => o.value === actType) && (
                  <option value={actType}>{actType}</option>
                )}
                {ACT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Input label="Numero" value={actNumber} onChange={(e) => setActNumber(e.target.value)} placeholder="241" />
            </div>
            <div>
              <Input label="Data" type="text" value={actDate} onChange={(e) => setActDate(e.target.value)} placeholder="aaaa o gg-mm-aaaa" />
            </div>
          </div>

          <Button type="button" onClick={fetchTree} loading={loading} className="w-full" icon={<Search size={16} aria-hidden />}>
            {loading ? 'Caricamento…' : 'Cerca articoli'}
          </Button>

          {loading && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center animate-pulse">
              Recupero della struttura della norma. Può richiedere qualche secondo.
            </p>
          )}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md text-sm">
              {error}
            </div>
          )}

          {tree.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {tree.length} articoli trovati • {selectedArticles.size} selezionati
                </span>
                <Button type="button" variant="link" onClick={toggleSelectAll}>
                  {allSelected ? 'Deseleziona tutti' : 'Seleziona tutti'}
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-100 dark:divide-slate-800">
                {tree.map((item, idx) => {
                  const articleNum = typeof item === 'string' ? item : Object.keys(item)[0];
                  const selected = selectedArticles.has(articleNum);
                  return (
                    // bare-button: a row of the list, the whole width a checkbox's target (`aria-pressed`), not a button's look.
                    <button
                      type="button"
                      key={idx}
                      onClick={() => toggleArticle(articleNum)}
                      aria-pressed={selected}
                      className="w-full h-9 px-3 text-left flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800"
                    >
                      {selected ? (
                        <CheckSquare size={16} className="text-primary-500" />
                      ) : (
                        <Square size={16} className="text-slate-400" />
                      )}
                      <span className="text-sm">Art. {articleNum}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-4 pb-4 md:px-5 md:pb-5">
          <Button type="button" variant="quiet" onClick={onClose}>
            Annulla
          </Button>
          <Button type="button" onClick={runImport} disabled={selectedArticles.size === 0}>
            Importa {selectedArticles.size > 0 ? `(${selectedArticles.size})` : ''}
          </Button>
        </div>
    </div>
  );
}
