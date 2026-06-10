import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Dead-letter log for events that failed to reach MERL-T.
 *
 * Slice 1 design: fire-and-forget on the frontend, so a 503 from the
 * BFF means the event is dropped — but we keep a paper trail in
 * `backend/logs/merlt-dead-letter.jsonl` for post-mortem.
 *
 * NDJSON format (one event per line) so it's grep-able and tail-able.
 * No PII beyond what's in the payload itself; rotating/retention is
 * out of scope (Slice 1).
 */

const LOG_DIR = process.env.MERLT_DEAD_LETTER_DIR ?? join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'merlt-dead-letter.jsonl');

// Cap the file so a prolonged MERL-T outage can't fill the disk.
const MAX_LOG_BYTES = 50 * 1024 * 1024;

let dirEnsured = false;
let sizeCapReached = false;

async function ensureDir(): Promise<void> {
  if (dirEnsured) return;
  await fs.mkdir(dirname(LOG_FILE), { recursive: true });
  dirEnsured = true;
}

export async function logDeadLetter(
  eventName: string,
  userId: string,
  payload: unknown,
  err: unknown
): Promise<void> {
  // Skip in test runs to keep test output clean unless explicitly enabled.
  if (process.env.NODE_ENV === 'test' && !process.env.MERLT_DEAD_LETTER_LOG_IN_TESTS) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    event: eventName,
    user_id: userId,
    error: err instanceof Error ? err.message : String(err),
    payload,
  };

  try {
    await ensureDir();
    const stat = await fs.stat(LOG_FILE).catch(() => null);
    if (stat && stat.size >= MAX_LOG_BYTES) {
      if (!sizeCapReached) {
        sizeCapReached = true;
        // eslint-disable-next-line no-console
        console.error(
          `[merlt] dead-letter log reached ${MAX_LOG_BYTES} bytes — dropping further entries (rotate or delete ${LOG_FILE})`
        );
      }
      return;
    }
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (logErr) {
    // Never let dead-letter logging crash the request path
    // eslint-disable-next-line no-console
    console.warn('[merlt] failed to write dead-letter log:', logErr);
  }
}
