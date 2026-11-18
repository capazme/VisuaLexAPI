import { useId } from 'react';

/**
 * The ids a field needs for its label and its message: the id the caller gave, or a generated one, and the
 * description the caller gave followed by the field's own message.
 */
export function useFieldIds(id: string | undefined, describedBy: string | undefined, message: string | undefined) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const messageId = `${fieldId}-message`;
  const describedByIds = [describedBy, message ? messageId : undefined].filter(Boolean).join(' ') || undefined;
  return { fieldId, messageId, describedByIds };
}
