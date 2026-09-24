import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let running = false;

export type NormaSnapshot = { norma_data: unknown; article_text: string };

/**
 * The two writers of normaWatch rows (this background watcher and
 * `checkNorma` in notificationController, driven by the frontend) must agree
 * on what "changed" means, or they ping-pong false notifications: a watch
 * created by one writer's norma_data shape looks permanently different from
 * a snapshot written by the other.
 *
 * Per gotcha 23, `article_text` is the scraper's frozen output contract —
 * equal text means unchanged, full stop. `norma_data` is metadata and is
 * never compared.
 *
 * 'baseline' marks a transition away from a pre-existing watch that predates
 * this contract (metadata-only, no article_text stored): the caller stores
 * the new snapshot and updates lastSeenAt, but must NOT create a
 * notification — there is no real previous text to have changed from.
 */
export function compareNormaSnapshots(
  previous: unknown,
  next: { norma_data: unknown; article_text: string },
): 'unchanged' | 'changed' | 'baseline' {
  const prev = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  const prevText = typeof prev.article_text === 'string' ? prev.article_text : '';
  if (!prevText) return 'baseline';
  return prevText === next.article_text ? 'unchanged' : 'changed';
}

function requestBody(data: Record<string, unknown>) {
  return {
    act_type: String(data.tipo_atto ?? ''),
    act_number: String(data.numero_atto ?? ''),
    date: String(data.data ?? ''),
    article: String(data.numero_articolo ?? ''),
    version: String(data.versione ?? 'vigente'),
    version_date: String(data.data_versione ?? ''),
    annex: data.allegato ? String(data.allegato) : undefined,
    show_brocardi_info: false,
  };
}

/** `LEGAL_API_URL` is the Python API's BASE url; this appends the endpoint
 * path. Stripping trailing slashes first keeps a base like
 * `http://localhost:5000/` from producing a double slash. */
function fetchArticleTextUrl(): string {
  const base = (process.env.LEGAL_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
  return `${base}/fetch_article_text`;
}

async function checkWatch(watch: { id: string; userId: string; normaKey: string; normaData: unknown }) {
  // Every exit advances lastSeenAt, the no-op ones included: the batch is
  // "the 100 least recently seen", so a watch that fails permanently (a
  // repealed article, malformed stored data) would otherwise sit at the
  // front of the queue forever and starve everything behind it.
  const touch = () => prisma.normaWatch.update({ where: { id: watch.id }, data: { lastSeenAt: new Date() } });

  if (!watch.normaData || typeof watch.normaData !== 'object') { await touch(); return; }
  const stored = watch.normaData as Record<string, unknown>;
  const normaData = stored.norma_data && typeof stored.norma_data === 'object'
    ? (stored.norma_data as Record<string, unknown>)
    : stored;

  const response = await fetch(fetchArticleTextUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody(normaData)),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) { await touch(); return; }
  const payload = await response.json() as unknown;
  const article = Array.isArray(payload) ? payload[0] as Record<string, unknown> | undefined : undefined;
  if (!article || article.error) { await touch(); return; }

  // Never fall back to the stored data: a malformed answer must be a no-op
  // on the snapshot, not a write that poisons it with stale metadata.
  if (!article.norma_data || typeof article.norma_data !== 'object') { await touch(); return; }
  if (typeof article.article_text !== 'string' || article.article_text.length === 0) { await touch(); return; }

  const snapshotForCompare: NormaSnapshot = { norma_data: article.norma_data, article_text: article.article_text };
  const outcome = compareNormaSnapshots(watch.normaData, snapshotForCompare);
  // Cast: article.norma_data came off the wire as parsed JSON from the Python
  // API, so it is already JSON-safe — Prisma's Json column input just wants
  // the stricter `InputJsonValue` type rather than `unknown`.
  const snapshot: Prisma.InputJsonObject = {
    norma_data: article.norma_data as Prisma.InputJsonValue,
    article_text: article.article_text,
  };

  if (outcome === 'unchanged') {
    await touch();
    return;
  }
  if (outcome === 'baseline') {
    await prisma.normaWatch.update({ where: { id: watch.id }, data: { normaData: snapshot, lastSeenAt: new Date() } });
    return;
  }
  await prisma.$transaction([
    prisma.normaWatch.update({ where: { id: watch.id }, data: { normaData: snapshot, lastSeenAt: new Date() } }),
    prisma.normaChangeNotification.create({
      data: { userId: watch.userId, watchId: watch.id, normaKey: watch.normaKey, message: `La norma salvata «${watch.normaKey}» è cambiata`, snapshot },
    }),
  ]);
}

export async function runNormaWatcher(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const watches = await prisma.normaWatch.findMany({ orderBy: { lastSeenAt: 'asc' }, take: 100 });
    for (const watch of watches) {
      try { await checkWatch(watch); } catch (error) { console.warn(`[norma-watcher] ${watch.normaKey}:`, error instanceof Error ? error.message : error); }
    }
  } finally {
    running = false;
  }
}

function isWatchEnabled(): boolean {
  const raw = (process.env.NORMA_WATCH_ENABLED ?? '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

export function startNormaWatcher(intervalMs = Number(process.env.NORMA_WATCH_INTERVAL_MS || 21600000)): NodeJS.Timeout | null {
  if (!isWatchEnabled()) {
    console.log('[norma-watcher] disabled via NORMA_WATCH_ENABLED');
    return null;
  }
  const interval = Math.max(60_000, intervalMs);
  return setInterval(() => { void runNormaWatcher(); }, interval);
}
