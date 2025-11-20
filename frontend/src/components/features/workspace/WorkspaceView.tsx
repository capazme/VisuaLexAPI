import { useState } from 'react';
import { Folder, FileText, Trash2, FolderPlus, ChevronRight, ArrowLeft, Download } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { DossierModal } from '../../ui/DossierModal';
import { jsPDF } from 'jspdf';

export function WorkspaceView() {
  const { dossiers, deleteDossier, removeFromDossier } = useAppStore();
  const [selectedDossierId, setSelectedDossierId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const selectedDossier = dossiers.find(d => d.id === selectedDossierId);

  const handleExportPdf = (dossierId: string) => {
      const dossier = dossiers.find(d => d.id === dossierId);
      if (!dossier) return;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      let y = 50;
      doc.setFontSize(18);
      doc.text(dossier.title, 40, y);
      doc.setFontSize(12);
      y += 20;
      dossier.items.forEach((item, idx) => {
          if (y > 760) {
              doc.addPage();
              y = 50;
          }
          doc.text(`${idx + 1}. ${item.type === 'norma' ? `${item.data.tipo_atto} n. ${item.data.numero_atto || ''} - Art. ${item.data.numero_articolo}` : 'Nota'}`, 40, y);
          y += 16;
          const content = item.type === 'norma' ? (item.data.article_text || '').replace(/<[^>]+>/g, '') : item.data;
          const wrapped = doc.splitTextToSize(content, 500);
          wrapped.forEach((line: string) => {
              if (y > 760) {
                  doc.addPage();
                  y = 50;
              }
              doc.text(line, 40, y);
              y += 14;
          });
          y += 10;
      });
      doc.save(`${dossier.title}.pdf`);
  };

  if (selectedDossier) {
      return (
          <div className="animate-in slide-in-from-right-10 duration-300">
              <button 
                onClick={() => setSelectedDossierId(null)}
                className="mb-4 flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors"
              >
                  <ArrowLeft size={16} /> Torna ai Dossier
              </button>

              <header className="mb-6 border-b border-gray-200 dark:border-gray-800 pb-4">
                  <div className="flex justify-between items-start">
                      <div>
                          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                              <Folder className="text-blue-500" size={28} />
                              {selectedDossier.title}
                          </h2>
                          {selectedDossier.description && <p className="text-gray-500 mt-1">{selectedDossier.description}</p>}
                          <div className="text-xs text-gray-400 mt-2">Creato il {new Date(selectedDossier.createdAt).toLocaleDateString()}</div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                            onClick={() => handleExportPdf(selectedDossier.id)}
                            className="text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 p-2 rounded-md transition-colors flex items-center gap-1"
                            title="Esporta PDF"
                        >
                            <Download size={18} /> PDF
                        </button>
                        <button 
                          onClick={() => {
                              if (confirm('Sei sicuro di voler eliminare questo dossier?')) {
                                  deleteDossier(selectedDossier.id);
                                  setSelectedDossierId(null);
                              }
                          }}
                          className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-md transition-colors"
                          title="Elimina Dossier"
                        >
                            <Trash2 size={20} />
                        </button>
                      </div>
                  </div>
              </header>

              <div className="grid gap-4">
                  {selectedDossier.items.length === 0 ? (
                      <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700">
                          <p className="text-gray-500">Questo dossier è vuoto.</p>
                          <p className="text-xs text-gray-400 mt-1">Aggiungi articoli dai risultati di ricerca.</p>
                      </div>
                  ) : (
                      selectedDossier.items.map(item => (
                          <div key={item.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm flex justify-between items-center group">
                              <div className="flex items-center gap-4">
                                  <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded text-blue-600">
                                      <FileText size={20} />
                                  </div>
                                  <div>
                                      {item.type === 'norma' ? (
                                          <>
                                              <h4 className="font-medium text-gray-900 dark:text-white">
                                                  {item.data.tipo_atto} {item.data.numero_atto}
                                              </h4>
                                              <p className="text-sm text-gray-500">Art. {item.data.numero_articolo} • {item.data.data}</p>
                                          </>
                                      ) : (
                                          <p className="text-gray-700 dark:text-gray-300 italic">"{item.data}"</p>
                                      )}
                                      <div className="text-xs text-gray-400 mt-1">Aggiunto il {new Date(item.addedAt).toLocaleDateString()}</div>
                                  </div>
                              </div>
                              <button 
                                onClick={() => removeFromDossier(selectedDossier.id, item.id)}
                                className="text-gray-400 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-all"
                                title="Rimuovi"
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

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">I tuoi Dossier</h2>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
          >
              <FolderPlus size={18} /> Nuovo Dossier
          </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {dossiers.length === 0 ? (
              <div className="col-span-full text-center py-20">
                  <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Folder size={40} className="text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">Nessun dossier creato</h3>
                  <p className="text-gray-500 dark:text-gray-400 mt-2">Organizza le tue ricerche creando dei dossier tematici.</p>
              </div>
          ) : (
              dossiers.map(dossier => (
                  <div 
                    key={dossier.id}
                    onClick={() => setSelectedDossierId(dossier.id)}
                    className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer group"
                  >
                      <div className="flex justify-between items-start mb-4">
                          <Folder className="text-blue-500 group-hover:scale-110 transition-transform" size={32} />
                          <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs px-2 py-1 rounded-full">
                              {dossier.items.length} elementi
                          </span>
                      </div>
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-1 group-hover:text-blue-600 transition-colors">
                          {dossier.title}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 min-h-[2.5em]">
                          {dossier.description || "Nessuna descrizione"}
                      </p>
                      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                          <span className="text-xs text-gray-400">{new Date(dossier.createdAt).toLocaleDateString()}</span>
                          <ChevronRight size={18} className="text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                      </div>
                  </div>
              ))
          )}
      </div>

      <DossierModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
