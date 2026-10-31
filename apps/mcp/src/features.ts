import type { McpConfig } from './config.js';

/** What `apps/server` has switched on, as its public `GET /features` says; asked once at each session's start. */
export interface Features {
  /** The glosses (D8): their switch and the web app's side the user validates them on, both. */
  glosses: boolean;
  /** Gymnasium's courses, «Percorsi» (A1; the switch `lingo_courses`, spec 2026-10-23 §10.10). */
  courses: boolean;
  /** A part of a split article as an entry of its own (G-387 (a); the switch `article_parts`). */
  articleParts: boolean;
}

/** Everything off when the server cannot say: a tool is listed only on the server's word (fail closed). */
export async function readFeatures(config: McpConfig): Promise<Features> {
  const off = { glosses: false, courses: false, articleParts: false };
  try {
    const response = await fetch(`${config.apiBase}/features`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return off;
    const body = (await response.json()) as { assistantGlosses?: unknown; assistantPassages?: unknown; lingoCourses?: unknown; articleParts?: unknown };
    return {
      glosses: body.assistantGlosses === true && body.assistantPassages === true,
      courses: body.lingoCourses === true,
      articleParts: body.articleParts === true,
    };
  } catch {
    return off;
  }
}
