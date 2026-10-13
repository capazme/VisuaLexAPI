import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * Dead-letter log for events that failed to reach MERL-T.
 *
 * Fire-and-forget on the frontend, so a 503 from the BFF means the event is
 * dropped; this keeps a trace for post-mortem: which event, when, which error,
 * and the event's identifiers (article URNs, ids of dossiers and environments,
 * numbers). Nothing replays it.
 *
 * It holds no personal data: never the user's id, never text the user wrote or
 * selected (a note, a highlight, a citation, tags), never their authority
 * (`redactDeadLetterPayload` keeps an allow-list, so a field added to an event
 * later stays out until someone adds it here). A day's entries go to
 * `merlt-dead-letter-YYYY-MM-DD.jsonl` (UTC) under `MERLT_DEAD_LETTER_DIR`
 * (default `logs/` under the working directory); files older than
 * `MERLT_DEAD_LETTER_RETENTION_DAYS` days (default 7) are deleted by
 * `sweepDeadLetters`, which `index.ts` runs at boot and every six hours. The
 * single file of the earlier format (`merlt-dead-letter.jsonl`), which held
 * user ids and note texts, is deleted by the first sweep.
 *
 * NDJSON (one event per line), so it's grep-able and tail-able.
 */

const FILE_PREFIX = 'merlt-dead-letter-';
const FILE_SUFFIX = '.jsonl';
const LEGACY_FILE = 'merlt-dead-letter.jsonl';
const DAY_FILE = /^merlt-dead-letter-(\d{4}-\d{2}-\d{2})\.jsonl$/;

// Cap the directory so a prolonged MERL-T outage can't fill the disk.
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The event fields a dead letter keeps: identifiers and numbers, no text. */
const KEPT_FIELDS = new Set([
  'type',
  'article_urn',
  'source_urn',
  'target_urn',
  'norma_visitata_id',
  'start_offset',
  'color',
  'dwell_ms',
  'scroll_max_pct',
  'shared_env_id',
  'articleUrn',
]);
const KEPT_CONTEXT_FIELDS = new Set(['dossier_id']);

let capWarned = false;

function logDir(): string {
  return process.env.MERLT_DEAD_LETTER_DIR ?? join(process.cwd(), 'logs');
}

export function retentionDays(): number {
  const raw = Number(process.env.MERLT_DEAD_LETTER_RETENTION_DAYS);
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_RETENTION_DAYS;
}

function pick(source: Record<string, unknown>, keep: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (keep.has(key) && value !== undefined) out[key] = value;
  }
  return out;
}

/** What of an event a dead letter keeps (see KEPT_FIELDS). */
export function redactDeadLetterPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const source = payload as Record<string, unknown>;
  const out = pick(source, KEPT_FIELDS);
  const context = source.context;
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    const kept = pick(context as Record<string, unknown>, KEPT_CONTEXT_FIELDS);
    if (Object.keys(kept).length > 0) out.context = kept;
  }
  return out;
}

async function totalBytes(dir: string): Promise<number> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  let total = 0;
  for (const name of names) {
    if (!DAY_FILE.test(name)) continue;
    const stat = await fs.stat(join(dir, name)).catch(() => null);
    total += stat?.size ?? 0;
  }
  return total;
}

export async function logDeadLetter(eventName: string, payload: unknown, err: unknown): Promise<void> {
  // Skip in test runs to keep test output clean unless explicitly enabled.
  if (process.env.NODE_ENV === 'test' && !process.env.MERLT_DEAD_LETTER_LOG_IN_TESTS) {
    return;
  }

  const now = new Date();
  const entry = {
    ts: now.toISOString(),
    event: eventName,
    // The error's class only: a message can carry what MERL-T answered.
    error: err instanceof Error ? err.name : typeof err,
    payload: redactDeadLetterPayload(payload),
  };

  try {
    const dir = logDir();
    await fs.mkdir(dir, { recursive: true });
    if ((await totalBytes(dir)) >= MAX_TOTAL_BYTES) {
      if (!capWarned) {
        capWarned = true;
        // eslint-disable-next-line no-console
        console.error(
          `[merlt] dead-letter logs reached ${MAX_TOTAL_BYTES} bytes — dropping further entries until the sweep deletes old days`
        );
      }
      return;
    }
    capWarned = false;
    const file = join(dir, `${FILE_PREFIX}${now.toISOString().slice(0, 10)}${FILE_SUFFIX}`);
    await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (logErr) {
    // Never let dead-letter logging crash the request path
    // eslint-disable-next-line no-console
    console.warn('[merlt] failed to write dead-letter log:', logErr instanceof Error ? logErr.name : logErr);
  }
}

/**
 * Delete the day files older than the retention period, and the legacy file.
 * Returns the names deleted. Never throws: it runs on a timer.
 */
export async function sweepDeadLetters(now: Date = new Date()): Promise<string[]> {
  const dir = logDir();
  const deleted: string[] = [];
  try {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    // The oldest day still kept, as YYYY-MM-DD: today counts as one of the days.
    const oldestKept = new Date(now.getTime() - (retentionDays() - 1) * DAY_MS).toISOString().slice(0, 10);
    for (const name of names) {
      const day = DAY_FILE.exec(name)?.[1];
      if (name !== LEGACY_FILE && !(day && day < oldestKept)) continue;
      try {
        await fs.unlink(join(dir, name));
        deleted.push(name);
      } catch {
        // gone already, or not ours to delete: the next sweep tries again
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[merlt] dead-letter sweep failed:', err instanceof Error ? err.name : err);
  }
  return deleted;
}

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Sweep now and every six hours. The timer does not keep the process alive. */
export function startDeadLetterSweeper(): NodeJS.Timeout {
  void sweepDeadLetters();
  const timer = setInterval(() => void sweepDeadLetters(), SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
