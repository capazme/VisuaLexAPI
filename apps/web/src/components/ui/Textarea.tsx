import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import { FIELD_TEXT } from '../../constants/interactions';
import { FIELD_CONTROL, FIELD_CONTROL_INVALID } from './controlStyles';
import { Field } from './Field';
import { useFieldIds } from './useFieldIds';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  /** The message in red without marking the field invalid (a limit passed while typing). */
  warning?: boolean;
}

/** A text area with the look of `Input` (LC104): the same radius, border, label and message; its height is its rows. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, warning, className, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const { fieldId, messageId, describedByIds } = useFieldIds(id, describedBy, error || helperText);
    return (
      <Field fieldId={fieldId} messageId={messageId} label={label} error={error || (warning ? helperText : undefined)} helperText={helperText}>
        <textarea
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          className={cn(FIELD_CONTROL, FIELD_TEXT, 'px-4 py-2.5 resize-y leading-relaxed', error && FIELD_CONTROL_INVALID, className)}
          {...props}
        />
      </Field>
    );
  }
);

Textarea.displayName = 'Textarea';
