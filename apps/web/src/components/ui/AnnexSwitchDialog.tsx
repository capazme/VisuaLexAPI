import { FileText, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Modal } from './Modal';

interface AnnexSwitchDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  articleNumber: string;
  annexLabel: string;
  annexNumber: string | null;
}

export function AnnexSwitchDialog({
  isOpen,
  onConfirm,
  onCancel,
  articleNumber,
  annexLabel,
}: AnnexSwitchDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      role="alertdialog"
      size="sm"
      variant="info"
      icon={<FileText size={20} />}
      title="Articolo in Allegato"
      description="Struttura documento rilevata"
      footer={
        <>
          <button
            onClick={onCancel}
            className={cn(
              'flex-1 px-5 py-3 rounded-xl text-sm font-bold transition-all',
              'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
              'active:scale-[0.98]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background'
            )}
          >
            No, resta qui
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'flex-1 px-5 py-3 rounded-xl text-sm font-bold transition-all',
              'bg-primary-500 hover:bg-primary-600 text-white',
              'shadow-lg shadow-primary-500/25',
              'active:scale-[0.98]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background'
            )}
          >
            Sì, vai all'allegato
          </button>
        </>
      }
    >
      <p className="text-slate-600 dark:text-slate-300 text-base leading-relaxed mb-6">
        L'<span className="font-bold text-slate-900 dark:text-white">Articolo {articleNumber}</span> si trova
        nell'<span className="font-bold text-primary-600 dark:text-primary-400">{annexLabel}</span>.
      </p>

      <div className="flex items-center justify-center gap-6 py-5 mb-6 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-100 dark:border-slate-700/50">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-2 mx-auto border border-slate-200 dark:border-slate-700">
            <span className="text-sm font-bold text-slate-400 dark:text-slate-500">Art.</span>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Dispositivo</span>
        </div>

        <ArrowRight size={24} className="text-primary-400 dark:text-primary-500" />

        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mb-2 mx-auto border-2 border-primary-400 dark:border-primary-600 shadow-lg shadow-primary-500/10">
            <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{articleNumber}</span>
          </div>
          <span className="text-xs text-primary-600 dark:text-primary-400 font-semibold">
            {annexLabel}
          </span>
        </div>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400 text-center font-medium">
        Vuoi visualizzare l'articolo nell'allegato?
      </p>
    </Modal>
  );
}
