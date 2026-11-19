/**
 * What the sign-in and the sign-up forms share besides the common controls (`Input`, `Button`, LC116): where an error
 * sends the focus. The error box and the password's eye are components, in `AuthFormParts.tsx`.
 */

/** Focus a field now, or as soon as it is enabled again (a request in flight disables it). */
export function focusField(el: HTMLInputElement | null, pending: { current: HTMLInputElement | null }) {
  if (!el) return;
  if (el.disabled) pending.current = el;
  else el.focus();
}
