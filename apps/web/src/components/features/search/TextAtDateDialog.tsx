import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { Clock } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import type { TextAtDateChoice } from '../../../utils/versionDisplay';

const FUTURE_MESSAGE = 'La data non può essere futura: Normattiva mostrerebbe il testo attuale.';
const EU_MESSAGE = 'Atti dell’Unione europea: il testo a una data non è disponibile.';

export interface TextAtDateDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (choice: TextAtDateChoice) => void;
    /** EUR-Lex acts have no text as at a date: the dialog says so and sends nothing. */
    euAct: boolean;
    /** Today in Rome (ISO): the latest day that can be asked for. */
    today: string;
    /** A day to start from, when there is one worth proposing. */
    initialDate?: string;
}

interface FormProps extends Omit<TextAtDateDialogProps, 'isOpen'> {
    inputRef: RefObject<HTMLInputElement | null>;
}

// Mounted only while the dialog is open, so every opening starts clean.
function TextAtDateForm({ onClose, onConfirm, euAct, today, initialDate, inputRef }: FormProps) {
    const [date, setDate] = useState(initialDate ?? '');
    const [original, setOriginal] = useState(false);

    const future = !original && date !== '' && date > today;
    const error = euAct ? EU_MESSAGE : future ? FUTURE_MESSAGE : null;
    const canSubmit = !euAct && (original || (date !== '' && !future));

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        onConfirm(original ? { kind: 'original' } : { kind: 'date', date });
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <div>
                <label htmlFor="text-at-date" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Data
                </label>
                <input
                    id="text-at-date"
                    ref={inputRef}
                    type="date"
                    value={date}
                    max={today}
                    disabled={euAct || original}
                    aria-invalid={future || undefined}
                    aria-describedby={error ? 'text-at-date-error' : undefined}
                    onChange={(event) => setDate(event.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
                />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                    type="checkbox"
                    checked={original}
                    disabled={euAct}
                    onChange={(event) => setOriginal(event.target.checked)}
                />
                Testo originale
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                La data non dice quale disciplina si applichi al fatto: possono contare disposizioni transitorie o efficacia retroattiva.
            </p>
            {error && (
                <p id="text-at-date-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {error}
                </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                    Annulla
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
                    <Clock size={16} />
                    Mostra il testo
                </Button>
            </div>
        </form>
    );
}

/**
 * "Testo alla data": asks for the text of the article in force on a day, or for
 * its original text. It validates before it sends — a future day is not sent —
 * and refuses EUR-Lex acts with the reason. What comes back opens in a tab of
 * its own, labelled with the day asked for; the toolbar shows the window the
 * source states.
 */
export function TextAtDateDialog({ isOpen, onClose, ...form }: TextAtDateDialogProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Testo alla data"
            description="Normattiva mostra il testo in vigore in quel giorno."
            size="sm"
            variant="info"
            icon={<Clock size={20} />}
            initialFocusRef={inputRef}
        >
            <TextAtDateForm {...form} onClose={onClose} inputRef={inputRef} />
        </Modal>
    );
}
