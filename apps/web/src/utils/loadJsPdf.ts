import type { jsPDF } from 'jspdf';

let pending: Promise<typeof jsPDF> | null = null;

/**
 * jsPDF, with pako and fast-png, loaded on the first export and kept for the next: ~120 KB compressed out of the
 * chunk every page loads, sign-in included. A load that fails is tried again on the next export (a chunk removed by a deploy keeps failing
 * until the page is reloaded, as a lazy route does).
 */
export function loadJsPdf(): Promise<typeof jsPDF> {
  pending ??= import('jspdf').then(
    (module) => module.jsPDF,
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}
