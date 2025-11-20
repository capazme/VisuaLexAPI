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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-gray-900 rounded-xl shadow-2xl w-full h-full max-w-6xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
          <h3 className="text-white font-medium flex items-center gap-2">
            <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs font-bold">PDF</span>
            Visualizzatore Documento
          </h3>
          <div className="flex items-center gap-2">
            {pdfUrl && (
              <a 
                href={pdfUrl} 
                download 
                className="p-2 hover:bg-gray-700 rounded-md text-gray-300 hover:text-white transition-colors"
                title="Scarica PDF"
              >
                <Download size={20} />
              </a>
            )}
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-md text-gray-300 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 relative bg-gray-950/50 flex items-center justify-center">
          {isLoading ? (
            <div className="text-center text-white">
              <Loader2 size={40} className="animate-spin mx-auto mb-4 text-blue-500" />
              <p className="text-gray-400">Generazione PDF in corso...</p>
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

