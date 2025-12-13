import { useState } from 'react';
import { Bookmark, Trash2, Tag, Filter, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';

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
          
          {/* Tag Filter - Pill Style */}
          {allTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
                      <Filter size={16} />
                      <span className="font-medium">Filtra per tag:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                      {selectedTag ? (
                          <button
                            onClick={() => setSelectedTag(null)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                          >
                              <Tag size={12} />
                              {selectedTag}
                              <X size={14} />
                          </button>
                      ) : (
                          <>
                              {allTags.map(tag => (
                                  <button
                                    key={tag}
                                    onClick={() => setSelectedTag(tag)}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                                        "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
                                        "hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300",
                                        "hover:scale-105"
                                    )}
                                  >
                                      <Tag size={12} />
                                      {tag}
                                  </button>
                              ))}
                          </>
                      )}
                  </div>
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
                  <div key={bookmark.id} className={cn(
                      "group relative bg-white dark:bg-gray-800 rounded-2xl border-2 p-6 transition-all cursor-pointer overflow-hidden",
                      "border-gray-200 dark:border-gray-700",
                      "hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-xl hover:-translate-y-1"
                  )}>
                      {/* Decorative blob */}
                      <div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 bg-blue-500/10 dark:bg-blue-500/20 rounded-full blur-2xl group-hover:bg-blue-500/20 dark:group-hover:bg-blue-500/30 transition-colors" />

                      <div className="relative z-10">
                          {/* Header with icon */}
                          <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                                      <Bookmark size={18} className="text-blue-600 dark:text-blue-400 fill-current" />
                                  </div>
                                  <div>
                                      <span className="inline-block px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs font-bold uppercase tracking-wider rounded-md">
                                          {bookmark.normaData.tipo_atto}
                                      </span>
                                  </div>
                              </div>
                              <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeBookmark(bookmark.normaKey);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500 transition-all"
                                title="Rimuovi segnalibro"
                              >
                                  <Trash2 size={16} />
                              </button>
                          </div>

                          {/* Content */}
                          <h4 className="font-bold text-xl text-gray-900 dark:text-white leading-tight mb-2">
                              {bookmark.normaData.numero_atto ? `n. ${bookmark.normaData.numero_atto}` : bookmark.normaData.data}
                          </h4>
                          <div className="flex items-center gap-2 mb-4">
                              <span className="font-semibold text-blue-600 dark:text-blue-400">Art. {bookmark.normaData.numero_articolo}</span>
                              <span className="text-gray-400 text-sm">• {bookmark.normaData.data}</span>
                          </div>

                          {/* Footer */}
                          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                              <div className="flex flex-wrap gap-1.5">
                                  {bookmark.tags?.slice(0, 2).map(tag => (
                                      <span key={tag} className="flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full font-medium">
                                          <Tag size={10} />
                                          {tag}
                                      </span>
                                  ))}
                                  {bookmark.tags && bookmark.tags.length > 2 && (
                                      <span className="text-xs text-gray-400 px-2 py-1">
                                          +{bookmark.tags.length - 2}
                                      </span>
                                  )}
                              </div>
                              <div className="text-xs text-gray-400 font-medium">
                                  {new Date(bookmark.addedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                              </div>
                          </div>
                      </div>
                  </div>
              ))
          )}
      </div>
    </div>
  );
}
