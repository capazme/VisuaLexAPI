import type { DecisionText } from '../types/decisions';

const PREVIEW_CHARACTERS = 600;
const PREVIEW_LINES = 8;

/** The first lines of a decision's text: its epigrafe, else its reasoning, else its dispositivo. */
export function previewLines(testo: DecisionText): string | null {
  const block = testo.epigrafe?.trim() || testo.motivazione?.trim() || testo.dispositivo?.trim();
  if (!block) return null;
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, PREVIEW_LINES).join('\n');
  return lines.length > PREVIEW_CHARACTERS ? `${lines.slice(0, PREVIEW_CHARACTERS).trimEnd()}…` : lines;
}
