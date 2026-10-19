import type { DecisionText } from '../types/decisions';
import { keyPassageText, keyPassages, type KeyPassageKind } from './decisionKeyPassages';

const PREVIEW_CHARACTERS = 600;
const PREVIEW_LINES = 8;

/** The first lines of a decision's text: its epigrafe, else its reasoning, else its dispositivo. */
export function previewLines(testo: DecisionText): string | null {
  const block = testo.epigrafe?.trim() || testo.motivazione?.trim() || testo.dispositivo?.trim();
  if (!block) return null;
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, PREVIEW_LINES).join('\n');
  return lines.length > PREVIEW_CHARACTERS ? `${lines.slice(0, PREVIEW_CHARACTERS).trimEnd()}…` : lines;
}

const cut = (text: string): string =>
  text.length > PREVIEW_CHARACTERS ? `${text.slice(0, PREVIEW_CHARACTERS).trimEnd()}…` : text;

/**
 * What a preview shows of a decision before its first lines (spec 2026-10-13-decision-key-passages-design,
 * «The preview»; the owner, 13 Oct 2026, «191-194 va bene»): its first key passage — the principle
 * of law, else the dispositivo — as it reads, cut as the first lines are. Null when it has none.
 */
export function previewKeyPassage(testo: DecisionText, corte: string): { kind: KeyPassageKind; text: string } | null {
  const passages = keyPassages(testo, corte);
  const first = passages.find((p) => p.kind === 'principio') ?? passages.find((p) => p.kind === 'dispositivo');
  if (!first) return null;
  const text = keyPassageText(testo, first);
  return text ? { kind: first.kind, text: cut(text) } : null;
}
