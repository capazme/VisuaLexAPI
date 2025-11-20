import { useState } from 'react';
import { Bookmark, Trash2, Tag, Filter } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';

export function BookmarksView() {
  const { bookmarks, removeBookmark } = useAppStore();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Extract all unique tags
  const allTags = Array.from(new Set(bookmarks.flatMap(b => b.tags || [])));

  const filteredBookmarks = selectedTag 
    ? bookmarks.filter(b => b.tags?.includes(selectedTag))
    : bookmarks;

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Bookmark className="text-blue-500 fill-current" size={28} />
              I tuoi Segnalibri
          </h2>
          
          {/* Tag Filter */}
          {allTags.length > 0 && (
              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="px-2 text-gray-400"><Filter size={14} /></div>
                  <button 
                    onClick={() => setSelectedTag(null)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${!selectedTag ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                  >
                      Tutti
                  </button>
                  {allTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => setSelectedTag(tag)}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${selectedTag === tag ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                      >
                          #{tag}
                      </button>
                  ))}
              </div>
          )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bookmarks.length === 0 ? (
              <div className="col-span-full text-center py-20">
                  <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Bookmark size={40} className="text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">Nessun segnalibro</h3>
                  <p className="text-gray-500 dark:text-gray-400 mt-2">Salva le norme più importanti cliccando sull'icona segnalibro.</p>
              </div>
          ) : (
              filteredBookmarks.map(bookmark => (
                  <div key={bookmark.id} className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all group relative">
                      
                      <div className="mb-3">
                          <span className="inline-block px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs font-bold uppercase tracking-wider rounded mb-2">
                              {bookmark.normaData.tipo_atto}
                          </span>
                          <h4 className="font-bold text-lg text-gray-900 dark:text-white leading-tight">
                              {bookmark.normaData.numero_atto ? `n. ${bookmark.normaData.numero_atto}` : bookmark.normaData.data}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                              <span className="font-medium text-gray-700 dark:text-gray-300">Art. {bookmark.normaData.numero_articolo}</span>
                              <span className="text-gray-400 text-sm">• {bookmark.normaData.data}</span>
                          </div>
                      </div>

                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                          <div className="flex gap-2">
                              {bookmark.tags?.map(tag => (
                                  <span key={tag} className="flex items-center text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded">
                                      <Tag size={10} className="mr-1" /> {tag}
                                  </span>
                              ))}
                          </div>
                          <div className="text-xs text-gray-400">
                              {new Date(bookmark.addedAt).toLocaleDateString()}
                          </div>
                      </div>

                      <button 
                        onClick={() => removeBookmark(bookmark.normaKey)}
                        className="absolute top-4 right-4 text-gray-300 hover:text-red-500 transition-colors"
                        title="Rimuovi segnalibro"
                      >
                          <Trash2 size={18} />
                      </button>
                  </div>
              ))
          )}
      </div>
    </div>
  );
}
