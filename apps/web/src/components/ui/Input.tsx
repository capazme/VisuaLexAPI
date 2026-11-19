import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { FIELD_TEXT } from '../../constants/interactions';
import { CONTROL_HEIGHT, FIELD_CONTROL, FIELD_CONTROL_INVALID } from './controlStyles';
import { Field } from './Field';
import { useFieldIds } from './useFieldIds';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  icon?: ReactNode;
  error?: string;
  helperText?: string;
  onFocusChange?: (focused: boolean) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, icon, error, helperText, onFocusChange, className, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const { fieldId, messageId, describedByIds } = useFieldIds(id, describedBy, error || helperText);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      onFocusChange?.(true);
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      onFocusChange?.(false);
      props.onBlur?.(e);
    };

    return (
      <Field fieldId={fieldId} messageId={messageId} label={label} error={error} helperText={helperText}>
        <div className="relative group">
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <div
                className={cn(
                  'transition-colors duration-(--dur-press)',
                  isFocused ? 'text-toga-600 dark:text-toga-400' : 'text-ink-500 dark:text-ink-400'
                )}
              >
                {icon}
              </div>
            </div>
          )}

          <input
            ref={ref}
            id={fieldId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedByIds}
            className={cn(
              FIELD_CONTROL,
              CONTROL_HEIGHT.md,
              FIELD_TEXT,
              error && FIELD_CONTROL_INVALID,
              icon ? 'pl-10 pr-4' : 'px-4',
              className
            )}
            onFocus={handleFocus}
            onBlur={handleBlur}
            {...props}
          />
        </div>
      </Field>
    );
  }
);

Input.displayName = 'Input';
