import { useState } from 'react';
import { Search, CheckSquare, Square, Loader2, TreeDeciduous } from 'lucide-react';
import { parseItalianDate } from '../../../utils/dateUtils';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

// Above this threshold we ask for explicit confirmation before importing —
// selecting "all" on a large code (e.g. CC ~2900 articles) is almost always a
// misclick and floods the dossier.
const BULK_IMPORT_CONFIRM_THRESHOLD = 100;

interface Props {
  onClose: () => void;
  onImport: (
    articles: { numero: string; urn?: string }[],
    normInfo: { tipo_atto: string; data: string; numero_atto: string }
  ) => void;
}

type TreeEntry = string | Record<string, string>;

export function TreeNavigatorModal({ onClose, onImport }: Props) {
  const [actType, setActType] = useState('codice civile');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [confirmBulkImportOpen, setConfirmBulkImportOpen] = useState(false);

  const fetchTree = async () => {
    setLoading(true);
    setError(null);
    try {
      // First get norma data to derive the URN used by the tree endpoint.
      const normaRes = await fetch('/fetch_norma_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          act_type: actType,
          act_number: actNumber || undefined,
          date: actDate ? parseItalianDate(actDate) : undefined,
          article: '1', // placeholder: we only need the URN from the response
        }),
      });
      const normaData = await normaRes.json();
      if (!normaData.urn) {
        throw new Error('Impossibile generare URN per questa norma');
      }

      const treeRes = await fetch('/fetch_tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: normaData.urn, link: true }),
      });
      const treeData = await treeRes.json();
      if (treeData.error) throw new Error(treeData.error);

      setTree(treeData.tree || []);
      setSelectedArticles(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel recupero della struttura');
    } finally {
      setLoading(false);
    }
  };

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
    onImport(articles, { tipo_atto: actType, data: actDate, numero_atto: actNumber });
    onClose();
  };

  const handleImport = () => {
    if (selectedArticles.size > BULK_IMPORT_CONFIRM_THRESHOLD) {
      setConfirmBulkImportOpen(true);
      return;
    }
    runImport();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] border border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <TreeDeciduous size={20} className="text-green-600" />
            Importa articoli da norma
          </h3>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo atto</label>
              <select
                value={actType}
                onChange={(e) => setActType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="codice civile">Codice Civile</option>
                <option value="codice penale">Codice Penale</option>
                <option value="codice procedura civile">Codice Procedura Civile</option>
                <option value="codice procedura penale">Codice Procedura Penale</option>
                <option value="costituzione">Costituzione</option>
                <option value="legge">Legge</option>
                <option value="decreto legislativo">Decreto Legislativo</option>
                <option value="decreto legge">Decreto Legge</option>
                <option value="d.p.r.">D.P.R.</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Numero</label>
              <input
                value={actNumber}
                onChange={(e) => setActNumber(e.target.value)}
                placeholder="241"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
              <input
                type="text"
                value={actDate}
                onChange={(e) => setActDate(e.target.value)}
                placeholder="aaaa o gg-mm-aaaa"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            </div>
          </div>

          <button
            onClick={fetchTree}
            disabled={loading}
            className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            {loading ? 'Caricamento...' : 'Cerca articoli'}
          </button>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {tree.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {tree.length} articoli trovati • {selectedArticles.size} selezionati
                </span>
                <button
                  onClick={toggleSelectAll}
                  className="text-sm text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                  {allSelected ? 'Deseleziona tutti' : 'Seleziona tutti'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                {tree.map((item, idx) => {
                  const articleNum = typeof item === 'string' ? item : Object.keys(item)[0];
                  const selected = selectedArticles.has(articleNum);
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleArticle(articleNum)}
                      aria-pressed={selected}
                      className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800"
                    >
                      {selected ? (
                        <CheckSquare size={16} className="text-blue-500" />
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

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Annulla
          </button>
          <button
            onClick={handleImport}
            disabled={selectedArticles.size === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            Importa {selectedArticles.size > 0 ? `(${selectedArticles.size})` : ''}
          </button>
        </div>

        <ConfirmDialog
          open={confirmBulkImportOpen}
          title={`Importare ${selectedArticles.size} articoli?`}
          message="Stai per aggiungere un numero elevato di articoli al dossier. L'operazione è reversibile ma potresti preferire una selezione più mirata."
          confirmLabel="Importa comunque"
          onConfirm={() => {
            setConfirmBulkImportOpen(false);
            runImport();
          }}
          onCancel={() => setConfirmBulkImportOpen(false)}
        />
      </div>
    </div>
  );
}
