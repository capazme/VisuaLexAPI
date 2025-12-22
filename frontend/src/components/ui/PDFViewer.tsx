import { X, Download, Loader2 } from 'lucide-react';

interface PDFViewerProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string | null;
  isLoading: boolean;
}

export function PDFViewer({ isOpen, onClose, pdfUrl, isLoading }: PDFViewerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-slate-900 rounded-xl shadow-2xl w-full h-full max-w-6xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 shrink-0">
          <h3 className="text-white font-bold flex items-center gap-3">
            <div className="bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              PDF
            </div>
            <span className="text-slate-300 font-medium">Visualizzatore Documento</span>
          </h3>
          <div className="flex items-center gap-3">
            {pdfUrl && (
              <a
                href={pdfUrl}
                download
                className="bg-slate-800 hover:bg-slate-700 text-white p-2.5 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium px-4"
                title="Scarica PDF"
              >
                <Download size={20} />
                <span className="hidden sm:inline">Scarica</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="bg-white text-slate-900 hover:bg-slate-200 p-2.5 rounded-lg transition-colors font-medium"
              title="Chiudi"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 relative bg-slate-950/50 flex items-center justify-center">
          {isLoading ? (
            <div className="text-center text-white">
              <Loader2 size={40} className="animate-spin mx-auto mb-4 text-blue-500" />
              <p className="text-slate-400">Generazione PDF in corso...</p>
            </div>
          ) : pdfUrl ? (
            <iframe 
              src={pdfUrl} 
              className="w-full h-full border-0" 
              title="PDF Viewer" 
            />
          ) : (
            <div className="text-red-400">Errore caricamento PDF</div>
          )}
        </div>
      </div>
    </div>
  );
}

