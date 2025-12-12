import React, { useState } from 'react';
import { Search, RefreshCw, Eraser, Plus, Minus } from 'lucide-react';
import type { SearchParams } from '../../../types';

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  isLoading: boolean;
}

const ACT_TYPES = [
  { label: 'Costituzione', value: 'costituzione', group: 'Fonti Primarie' },
  { label: 'Legge', value: 'legge', group: 'Fonti Primarie' },
  { label: 'Decreto Legge', value: 'decreto legge', group: 'Fonti Primarie' },
  { label: 'Decreto Legislativo', value: 'decreto legislativo', group: 'Fonti Primarie' },
  { label: 'Codice Civile', value: 'codice civile', group: 'Codici' },
  { label: 'Codice Penale', value: 'codice penale', group: 'Codici' },
  { label: 'Codice Proc. Civile', value: 'codice di procedura civile', group: 'Codici' },
  { label: 'Codice Proc. Penale', value: 'codice di procedura penale', group: 'Codici' },
  { label: 'Regolamento UE', value: 'Regolamento UE', group: 'Unione Europea' },
  { label: 'Direttiva UE', value: 'Direttiva UE', group: 'Unione Europea' },
  { label: 'TUE', value: 'TUE', group: 'Unione Europea' },
  { label: 'TFUE', value: 'TFUE', group: 'Unione Europea' },
  { label: 'CDFUE', value: 'CDFUE', group: 'Unione Europea' },
  { label: 'Codice Navigazione', value: 'codice della navigazione', group: 'Altri' },
  { label: 'Codice Strada', value: 'codice della strada', group: 'Altri' },
  { label: 'Codice Proc. Amm.', value: 'codice del processo amministrativo', group: 'Altri' },
  { label: 'Codice Crisi Impresa', value: "codice della crisi d'impresa e dell'insolvenza", group: 'Altri' },
];

const ACT_TYPES_REQUIRING_DETAILS = [
    'legge', 'decreto legge', 'decreto legislativo', 
    'Regolamento UE', 'Direttiva UE'
];

export function SearchForm({ onSearch, isLoading }: SearchFormProps) {
  const [formData, setFormData] = useState<SearchParams>({
    act_type: '',
    act_number: '',
    date: '',
    article: '1',
    version: 'vigente',
    version_date: '',
    show_brocardi_info: false
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleIncrementArticle = () => {
    setFormData(prev => ({ ...prev, article: (parseInt(prev.article) + 1).toString() }));
  };

  const handleDecrementArticle = () => {
    setFormData(prev => {
      const val = parseInt(prev.article);
      return { ...prev, article: val > 1 ? (val - 1).toString() : '1' };
    });
  };

  const isDetailsRequired = ACT_TYPES_REQUIRING_DETAILS.includes(formData.act_type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(formData);
  };

  const handleReset = () => {
    setFormData({
      act_type: '',
      act_number: '',
      date: '',
      article: '1',
      version: 'vigente',
      version_date: '',
      show_brocardi_info: false
    });
  };

  // Group options
  const groupedOptions = ACT_TYPES.reduce((acc, option) => {
    if (!acc[option.group]) acc[option.group] = [];
    acc[option.group].push(option);
    return acc;
  }, {} as Record<string, typeof ACT_TYPES>);

  return (
    <div className="card bg-white dark:bg-gray-800 shadow-sm rounded-lg border border-gray-200 dark:border-gray-700 sticky top-6">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h5 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Search size={18} />
          Parametri
        </h5>
      </div>
      <div className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="search-act-type" className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tipo atto</label>
            <select 
              id="search-act-type" 
              name="act_type" 
              value={formData.act_type} 
              onChange={handleChange}
              className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
              required
            >
              <option value="">Seleziona...</option>
              {Object.entries(groupedOptions).map(([group, options]) => (
                <optgroup label={group} key={group}>
                  {options.map(opt => (
                    <option value={opt.value} key={opt.value}>{opt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="act_number" className="block text-xs font-semibold text-gray-500 uppercase mb-1">Numero</label>
              <input 
                type="text" 
                id="act_number" 
                name="act_number" 
                value={formData.act_number} 
                onChange={handleChange}
                disabled={!isDetailsRequired}
                placeholder="n."
                className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 p-2 border"
              />
            </div>
            <div>
              <label htmlFor="date" className="block text-xs font-semibold text-gray-500 uppercase mb-1">Data</label>
              <input 
                type="text" 
                id="date" 
                name="date" 
                value={formData.date} 
                onChange={handleChange}
                disabled={!isDetailsRequired}
                placeholder="aaaa"
                className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 p-2 border"
              />
            </div>
          </div>

          {/* Modern Article Number Input */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-400 uppercase">Articolo</label>
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
              <button
                type="button"
                onClick={handleDecrementArticle}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-gray-700 shadow-sm transition-all text-gray-600 dark:text-gray-400"
                title="Decrementa articolo"
              >
                <Minus size={16} />
              </button>
              <input
                type="text"
                id="article"
                name="article"
                value={formData.article}
                onChange={handleChange}
                className="flex-1 bg-transparent text-center font-mono text-xl font-bold border-none focus:ring-0 text-gray-900 dark:text-white outline-none"
              />
              <button
                type="button"
                onClick={handleIncrementArticle}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-gray-700 shadow-sm transition-all text-gray-600 dark:text-gray-400"
                title="Incrementa articolo"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="bg-gray-100 dark:bg-gray-700/50 p-3 rounded-md">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Versione</label>
            <div className="flex gap-4 mb-2">
              <div className="flex items-center">
                <input 
                  type="radio" 
                  id="vigente" 
                  name="version" 
                  value="vigente" 
                  checked={formData.version === 'vigente'} 
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <label htmlFor="vigente" className="ml-2 text-sm text-gray-700 dark:text-gray-300">Vigente</label>
              </div>
              <div className="flex items-center">
                <input 
                  type="radio" 
                  id="originale" 
                  name="version" 
                  value="originale" 
                  checked={formData.version === 'originale'} 
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <label htmlFor="originale" className="ml-2 text-sm text-gray-700 dark:text-gray-300">Originale</label>
              </div>
            </div>
            <input 
              type="date" 
              name="version_date" 
              value={formData.version_date}
              onChange={handleChange}
              disabled={true} 
              className="w-full text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm p-2 border disabled:opacity-50"
            />
          </div>

          <div className="flex items-center">
            <input 
              type="checkbox" 
              id="show_brocardi_info" 
              name="show_brocardi_info" 
              checked={formData.show_brocardi_info} 
              onChange={handleChange}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="show_brocardi_info" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
              Includi Brocardi & Ratio
            </label>
          </div>

          <div className="space-y-2 pt-2">
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 px-4 rounded-md font-medium shadow-sm transition-colors disabled:opacity-70"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <Search size={18} />
              )}
              Estrai
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={handleReset} className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 py-1.5 px-3 rounded-md text-sm transition-colors">
                <RefreshCw size={14} /> Reset
              </button>
              <button type="button" onClick={handleReset} className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 py-1.5 px-3 rounded-md text-sm transition-colors">
                <Eraser size={14} /> Pulisci
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
