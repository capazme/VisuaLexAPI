import { useState } from 'react';
import { Folder, FileText, Trash2, FolderPlus, ArrowLeft, Download } from 'lucide-react';
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
                    className="mb-4 flex items-center gap-2 text-sm text-slate-500 hover:text-primary-600 transition-colors bg-white/50 dark:bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700"
                >
                    <ArrowLeft size={16} /> Torna ai Dossier
                </button>

                <header className="mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                                <Folder className="text-primary-500 fill-primary-100 dark:fill-primary-900/30" size={28} />
                                {selectedDossier.title}
                            </h2>
                            {selectedDossier.description && <p className="text-slate-500 mt-1">{selectedDossier.description}</p>}
                            <div className="text-xs text-slate-400 mt-2">Creato il {new Date(selectedDossier.createdAt).toLocaleDateString()}</div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleExportPdf(selectedDossier.id)}
                                className="text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 p-2 rounded-md transition-colors flex items-center gap-1 border border-transparent hover:border-emerald-100 dark:hover:border-emerald-900/40"
                                title="Esporta PDF"
                            >
                                <Download size={18} /> <span className="text-sm font-medium">PDF</span>
                            </button>
                            <button
                                onClick={() => {
                                    if (confirm('Sei sicuro di voler eliminare questo dossier?')) {
                                        deleteDossier(selectedDossier.id);
                                        setSelectedDossierId(null);
                                    }
                                }}
                                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-md transition-colors border border-transparent hover:border-red-100 dark:hover:border-red-900/40"
                                title="Elimina Dossier"
                            >
                                <Trash2 size={20} />
                            </button>
                        </div>
                    </div>
                </header>

                <div className="grid gap-4">
                    {selectedDossier.items.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                            <p className="text-slate-500 font-medium">Questo dossier è vuoto.</p>
                            <p className="text-xs text-slate-400 mt-1">Aggiungi articoli dai risultati di ricerca.</p>
                        </div>
                    ) : (
                        selectedDossier.items.map(item => (
                            <div key={item.id} className="bg-white dark:bg-slate-800/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all flex justify-between items-center group relative overflow-hidden">
                                <div className="flex items-center gap-4 relative z-10">
                                    <div className="bg-primary-50 dark:bg-primary-900/20 p-2.5 rounded-lg text-primary-600 dark:text-primary-400">
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        {item.type === 'norma' ? (
                                            <>
                                                <h4 className="font-semibold text-slate-900 dark:text-white">
                                                    {item.data.tipo_atto} {item.data.numero_atto}
                                                </h4>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">Art. {item.data.numero_articolo} • {item.data.data}</p>
                                            </>
                                        ) : (
                                            <p className="text-slate-700 dark:text-slate-300 italic font-medium">"{item.data}"</p>
                                        )}
                                        <div className="text-xs text-slate-400 mt-1">Aggiunto il {new Date(item.addedAt).toLocaleDateString()}</div>
                                    </div>
                                </div>

                                {/* Hover background effect */}
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-slate-50/50 dark:to-slate-700/30 opacity-0 group-hover:opacity-100 transition-opacity" />

                                <button
                                    onClick={() => removeFromDossier(selectedDossier.id, item.id)}
                                    className="relative z-10 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0"
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
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">I tuoi Dossier</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Gestisci e organizza le tue ricerche giuridiche</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-md hover:shadow-lg hover:shadow-primary-600/20 active:scale-[0.98]"
                >
                    <FolderPlus size={18} />
                    <span className="font-medium">Nuovo Dossier</span>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {dossiers.length === 0 ? (
                    <div className="col-span-full text-center py-24 bg-white/50 dark:bg-slate-900/30 rounded-2xl border border-slate-200 dark:border-slate-800 border-dashed">
                        <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                            <Folder size={32} />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Nessun dossier creato</h3>
                        <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-sm mx-auto">Organizza le tue ricerche creando dei dossier tematici per salvare articoli e note.</p>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="mt-6 text-primary-600 dark:text-primary-400 font-medium hover:underline"
                        >
                            Inizia creando il primo dossier
                        </button>
                    </div>
                ) : (
                    dossiers.map(dossier => (
                        <div
                            key={dossier.id}
                            onClick={() => setSelectedDossierId(dossier.id)}
                            className="group relative bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 transition-all hover:-translate-y-1 hover:shadow-xl cursor-pointer overflow-hidden"
                        >
                            {/* Decorative blob */}
                            <div className="absolute top-0 right-0 -mr-12 -mt-12 w-40 h-40 bg-primary-500/5 dark:bg-primary-500/10 rounded-full blur-3xl group-hover:bg-primary-500/10 dark:group-hover:bg-primary-500/20 transition-all duration-500" />

                            <div className="relative z-10">
                                <div className="flex justify-between items-start mb-5">
                                    <div className="bg-primary-50 dark:bg-primary-900/30 p-3.5 rounded-2xl text-primary-600 dark:text-primary-400 shadow-sm group-hover:scale-110 transition-transform duration-300">
                                        <Folder size={24} className="fill-current/20" />
                                    </div>
                                    {dossier.isPinned && (
                                        <span className="w-2.5 h-2.5 bg-amber-400 rounded-full ring-2 ring-white dark:ring-slate-800" title="In evidenza" />
                                    )}
                                </div>

                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors line-clamp-1">
                                    {dossier.title}
                                </h3>

                                <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[2.5em] mb-4">
                                    {dossier.description || "Nessuna descrizione"}
                                </p>

                                <div className="flex items-center gap-4 text-xs font-medium text-slate-400 dark:text-slate-500 pt-4 border-t border-slate-100 dark:border-slate-700/50">
                                    <div className="flex items-center gap-1.5">
                                        <FileText size={14} />
                                        <span>{dossier.items.length} elementi</span>
                                    </div>
                                    <div className="ml-auto">
                                        <span>{new Date(dossier.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <DossierModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </div>
    );
}
