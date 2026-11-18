import type { ReactNode } from 'react';
import { FIELD_ERROR, FIELD_HELP, FIELD_LABEL } from './controlStyles';

interface FieldProps {
  fieldId: string;
  messageId: string;
  label?: string;
  error?: string;
  helperText?: string;
  children: ReactNode;
}

/** The label above, the control, and the error (or else the helper text) below: one form for `Input` and `Select`. */
export function Field({ fieldId, messageId, label, error, helperText, children }: FieldProps) {
  const message = error || helperText;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className={FIELD_LABEL}>
          {label}
        </label>
      )}
      {children}
      {message && (
        <p id={messageId} className={`mt-1.5 ${error ? FIELD_ERROR : FIELD_HELP}`}>
          {message}
        </p>
      )}
    </div>
  );
}
