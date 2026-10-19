import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

const ALLOWED_EXT = /\.(pdf|txt|docx)$/i;
const MAX_BYTES = 50 * 1024 * 1024;

export interface UploadDropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

/** File picker for study notes (PDF/TXT/DOCX ≤50MB). Validates before handing off. */
export function UploadDropzone({ onFile, disabled }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateAndEmit = (file: File | undefined): void => {
    if (!file) return;
    if (!ALLOWED_EXT.test(file.name)) {
      setError('Formato non supportato. Usa PDF, TXT o DOCX.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File troppo grande (max 50MB).');
      return;
    }
    setError(null);
    onFile(file);
  };

  return (
    <div>
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center dark:border-slate-700"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled) validateAndEmit(e.dataTransfer.files?.[0]);
        }}
      >
        <UploadCloud className="text-primary-500" size={32} />
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Trascina qui i tuoi appunti, oppure
        </p>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
          Scegli un file
        </Button>
        <p className="text-xs text-slate-400">PDF, TXT o DOCX · max 50MB</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.docx"
          className="hidden"
          aria-label="Carica appunti"
          onChange={(e) => validateAndEmit(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
