import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FIELD_TEXT } from '../../constants/interactions';
import { CONTROL_HEIGHT, FIELD_CONTROL, FIELD_CONTROL_INVALID, type ControlSize } from './controlStyles';
import { Field } from './Field';
import { useFieldIds } from './useFieldIds';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  /** Icon to show on the left */
  icon?: ReactNode;
  size?: ControlSize;
}

// At least 16 px below md on every size: Safari on an iPhone zooms into a smaller select (`FIELD_TEXT`).
const textStyles: Record<ControlSize, string> = {
  sm: 'text-[length:max(1rem,16px)] md:text-xs',
  md: FIELD_TEXT,
  lg: 'text-base',
};

/**
 * A native `<select>` with the look of `Input`: no system arrow (`appearance-none`), a chevron in the ink of the
 * placeholder, the same label and message. The list that opens stays the system's.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, icon, size = 'md', className, children, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const { fieldId, messageId, describedByIds } = useFieldIds(id, describedBy, error || helperText);

    return (
      <Field fieldId={fieldId} messageId={messageId} label={label} error={error} helperText={helperText}>
        <div className="relative">
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-500 dark:text-ink-400">
              {icon}
            </div>
          )}

          <select
            ref={ref}
            id={fieldId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedByIds}
            className={cn(
              FIELD_CONTROL,
              'appearance-none cursor-pointer',
              CONTROL_HEIGHT[size],
              textStyles[size],
              error && FIELD_CONTROL_INVALID,
              icon ? 'pl-10 pr-10' : 'pl-4 pr-10',
              className
            )}
            {...props}
          >
            {children}
          </select>

          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-ink-500 dark:text-ink-400">
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          </div>
        </div>
      </Field>
    );
  }
);

Select.displayName = 'Select';
