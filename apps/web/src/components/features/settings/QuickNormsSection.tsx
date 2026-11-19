import { useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { X, Plus, Link, FileText, Star, Trash2, ExternalLink, Pencil, Check } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useSearchActions } from '../../../hooks/useSearchActions';
import { parseNormattivaUrl, generateLabelFromParams, validateSearchParams } from '../../../utils/normattivaParser';
import type { SearchParams, QuickNorm } from '../../../types';
import { cn } from '../../../lib/utils';
import { getActTypesByGroup } from '../../../constants/actTypes';
import { AttributionChip } from '../bulletin/AttributionChip';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { SegmentedTabs } from '../../ui/SegmentedTabs';
import { CARD_RADIUS } from '../../ui/controlStyles';
import { buttonClassName } from '../../ui/buttonStyles';

type InputMode = 'url' | 'manual';

// Relative "ultima <when>" recency label from an ISO timestamp. Returns
// null when the timestamp is absent or unparseable so the caller can omit
// it. Mirrors the date-fns + it-locale pattern used in EnvironmentCard.
function formatLastUsed(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `ultima ${formatDistanceToNow(date, { addSuffix: true, locale: it })}`;
}

/**
 * The quick norms (LC84: «Norme rapide», a part of the Impostazioni page; it was a dialog over the page). One used from
 * the list runs as it always did (a trigger, checked for an annex) and brings the reader to the search page.
 */
export function QuickNormsSection() {
  const { quickNorms, addQuickNorm, removeQuickNorm, updateQuickNormLabel, selectQuickNorm } = useAppStore();
  const { trigger } = useSearchActions();

  const [inputMode, setInputMode] = useState<InputMode>('manual');
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  // Manual form state
  const [actType, setActType] = useState('codice civile');
  const [actNumber, setActNumber] = useState('');
  const [actDate, setActDate] = useState('');
  const [article, setArticle] = useState('1');
  const [customLabel, setCustomLabel] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const resetForm = useCallback(() => {
    setUrlInput('');
    setUrlError(null);
    setActType('codice civile');
    setActNumber('');
    setActDate('');
    setArticle('1');
    setCustomLabel('');
  }, []);

  const handleUrlParse = useCallback(() => {
    if (!urlInput.trim()) {
      setUrlError('Inserisci un URL di Normattiva');
      return;
    }

    const result = parseNormattivaUrl(urlInput);

    if (!result.success || !result.params) {
      setUrlError(result.error || 'Impossibile parsare l\'URL');
      return;
    }

    // Fill form with parsed data
    if (result.params.act_type) setActType(result.params.act_type);
    if (result.params.act_number) setActNumber(result.params.act_number);
    if (result.params.date) setActDate(result.params.date);
    if (result.params.article) setArticle(result.params.article);

    // Generate suggested label
    setCustomLabel(generateLabelFromParams(result.params));
    setUrlError(null);

    // Switch to manual mode to review/edit
    setInputMode('manual');
  }, [urlInput]);

  const handleAddQuickNorm = useCallback(() => {
    const searchParams: SearchParams = {
      act_type: actType,
      act_number: actNumber,
      date: actDate,
      article: article || '1',
      version: 'vigente',
    };

    if (!validateSearchParams(searchParams)) {
      return;
    }

    const label = customLabel.trim() || generateLabelFromParams(searchParams);
    addQuickNorm(label, searchParams, inputMode === 'url' ? urlInput : undefined);
    resetForm();
  }, [actType, actNumber, actDate, article, customLabel, urlInput, inputMode, addQuickNorm, resetForm]);

  const handleUseQuickNorm = useCallback((qn: QuickNorm) => {
    selectQuickNorm(qn.id);
    trigger(qn.searchParams);
  }, [selectQuickNorm, trigger]);

  const handleStartEdit = useCallback((qn: QuickNorm) => {
    setEditingId(qn.id);
    setEditLabel(qn.label);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingId && editLabel.trim()) {
      updateQuickNormLabel(editingId, editLabel.trim());
    }
    setEditingId(null);
    setEditLabel('');
  }, [editingId, editLabel, updateQuickNormLabel]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditLabel('');
  }, []);

  return (
        <div id="tour-quicknorms-panel" className="space-y-6">
          {/* Add New Section */}
          <div id="tour-qn-add" className="space-y-4">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Aggiungi una norma</h4>

            <SegmentedTabs
              size="sm"
              label="Come aggiungere la norma"
              value={inputMode}
              onChange={setInputMode}
              tabs={[
                { id: 'manual', label: <><FileText size={16} aria-hidden /> Manuale</> },
                { id: 'url', label: <><Link size={16} aria-hidden /> Da un link</> },
              ]}
              className="w-full"
              tabClassName="flex-1"
            />

            {/* URL Input */}
            {inputMode === 'url' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      type="url"
                      value={urlInput}
                      onChange={(e) => {
                        setUrlInput(e.target.value);
                        setUrlError(null);
                      }}
                      placeholder="Incolla link di Normattiva…"
                      aria-label="Link di Normattiva"
                      error={urlError ?? undefined}
                    />
                  </div>
                  <Button type="button" onClick={handleUrlParse}>Importa</Button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Esempio: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art1
                </p>
              </div>
            )}

            {/* Manual Form */}
            {inputMode === 'manual' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Select label="Tipo di atto" value={actType} onChange={(e) => setActType(e.target.value)}>
                    {Object.entries(getActTypesByGroup()).map(([group, acts]) => (
                      <optgroup key={group} label={group}>
                        {acts.map(at => (
                          <option key={at.value} value={at.value}>{at.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <Input label="Articolo" type="text" value={article} onChange={(e) => setArticle(e.target.value)} placeholder="es. 2043" />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Numero dell’atto (facoltativo)" type="text" value={actNumber} onChange={(e) => setActNumber(e.target.value)} placeholder="es. 241" />
                  <Input label="Data (facoltativa)" type="text" value={actDate} onChange={(e) => setActDate(e.target.value)} placeholder="aaaa-mm-gg" />
                </div>

                <Input label="Nome (facoltativo)" type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="es. Risarcimento del danno" />

                <Button type="button" className="w-full" icon={<Plus size={16} aria-hidden />} onClick={handleAddQuickNorm} disabled={!actType || !article}>
                  Aggiungi alle norme rapide
                </Button>
              </div>
            )}
          </div>

          {/* Saved QuickNorms */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Le tue norme rapide ({quickNorms.length})
            </h4>

            {quickNorms.length === 0 ? (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                <Star className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nessuna norma rapida</p>
                <p className="text-xs mt-1">Aggiungi le norme che consulti spesso per accedervi rapidamente</p>
              </div>
            ) : (
              <div className="space-y-2">
                {quickNorms.map((qn, index) => (
                  <div
                    key={qn.id}
                    id={index === 0 ? 'tour-quicknorms-item' : undefined}
                    className={cn('group flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors', CARD_RADIUS)}
                  >
                    {editingId === qn.id ? (
                      // Edit mode
                      <>
                        <Star className="w-4 h-4 text-amber-500 shrink-0" />
                        <div className="flex-1 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <Input
                              type="text"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                // Esc gives up the change and stays on the page, before the page's own Esc goes back.
                                if (e.key === 'Escape') { e.preventDefault(); handleCancelEdit(); }
                              }}
                              aria-label="Nome della norma rapida"
                              autoFocus
                            />
                          </div>
                          <IconButton icon={<Check size={16} />} onClick={handleSaveEdit} aria-label="Salva" title="Salva" />
                          <IconButton icon={<X size={16} />} onClick={handleCancelEdit} aria-label="Annulla" title="Annulla" />
                        </div>
                      </>
                    ) : (
                      // View mode
                      <>
                        {/* bare-button: the whole row is the norm to open, its words and its counts. */}
                        <button
                          type="button"
                          onClick={() => handleUseQuickNorm(qn)}
                          className="flex-1 flex items-center gap-3 text-left"
                        >
                          <Star className="w-4 h-4 text-amber-500 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-medium text-slate-900 dark:text-white truncate">
                                {qn.label}
                              </p>
                              {qn.sourceSuggestionId && (
                                <AttributionChip author={qn.originalAuthor} className="ml-1" />
                              )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {qn.searchParams.act_type}
                              {qn.searchParams.act_number && ` n. ${qn.searchParams.act_number}`}
                              {qn.usageCount > 0 && ` · Usato ${qn.usageCount}x`}
                              {qn.usageCount > 0 && formatLastUsed(qn.lastUsedAt) && ` · ${formatLastUsed(qn.lastUsedAt)}`}
                            </p>
                          </div>
                        </button>

                        {/* In sight at every width: a phone has no pointer to bring them out, the keyboard neither. */}
                        <div className="flex items-center gap-1">
                          <IconButton icon={<Pencil size={16} />} onClick={() => handleStartEdit(qn)} aria-label="Rinomina" title="Rinomina" />
                          {qn.sourceUrl && (
                            <a
                              href={qn.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(buttonClassName('quiet'), 'min-w-11 px-0 md:min-w-9')}
                              aria-label="Apri su Normattiva"
                              title="Apri su Normattiva"
                            >
                              <ExternalLink size={16} aria-hidden />
                            </a>
                          )}
                          <IconButton icon={<Trash2 size={16} />} onClick={() => removeQuickNorm(qn.id)} aria-label="Rimuovi" title="Rimuovi" className="hover:text-red-600 dark:hover:text-red-400" />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
  );
}
