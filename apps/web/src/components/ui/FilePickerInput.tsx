/**
 * The file input behind a control that opens the system's file picker («Scegli un documento», «Importa»).
 * The control is a real button whose click handler calls the input's `click()` at once, in the same task:
 * a picker opened after an `await` or a timer has lost the user's gesture, and the browser refuses it.
 * The input sits beside the control, never inside it (its click would climb back to the button), and is
 * hidden from sight and from the keyboard but laid out (`sr-only`, not `display: none`), so opening it does
 * not rest on how a browser treats a `click()` on an element with no box. Its value is cleared before the
 * file is handed on, so choosing the same file again reads it again. One file: `onFile` takes the first.
 */
import { forwardRef, type InputHTMLAttributes } from 'react';

interface FilePickerInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'className' | 'multiple'> {
  accept: string;
  onFile: (file: File) => void;
}

export const FilePickerInput = forwardRef<HTMLInputElement, FilePickerInputProps>(
  function FilePickerInput({ accept, onFile, ...rest }, ref) {
    return (
      <input
        {...rest}
        ref={ref}
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
    );
  },
);
