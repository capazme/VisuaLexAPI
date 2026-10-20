/**
 * The classes the sign-in and the sign-up forms share, on paper (spec 2026-10-18-redesign-inchiostro §5.3.4):
 * the field, its label, the primary button and the link that changes tab; and where an error sends the focus.
 * The error box and the password's eye are components, in `AuthFormParts.tsx`.
 */
import { FOCUS_RING } from '../../constants/interactions';

export const FIELD =
  'w-full h-11 rounded-md border border-slate-200 bg-slate-50 px-3.5 text-base md:text-[15px] text-slate-900 placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25 aria-[invalid=true]:border-red-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:aria-[invalid=true]:border-red-400';

export const LABEL = 'block text-sm font-medium text-slate-900 dark:text-slate-100';

export const PRIMARY_BUTTON =
  'flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 font-semibold text-white transition-[background-color,transform,scale] hover:bg-primary-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-400 dark:text-slate-950 dark:hover:bg-primary-300 ' +
  FOCUS_RING;

/** The inline «Registrati» / «Accedi» under a form: it changes the tab, not the page. */
export const SWITCH_LINK = `-mx-1 inline-flex min-h-[44px] items-center rounded-md px-1 font-medium text-primary-600 hover:underline dark:text-primary-400 ${FOCUS_RING}`;

/** Focus a field now, or as soon as it is enabled again (a request in flight disables it). */
export function focusField(el: HTMLInputElement | null, pending: { current: HTMLInputElement | null }) {
  if (!el) return;
  if (el.disabled) pending.current = el;
  else el.focus();
}
