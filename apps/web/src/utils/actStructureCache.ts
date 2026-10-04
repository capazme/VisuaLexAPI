import { legalFetch } from '../services/legalFetch';
import type { TreeMetadata } from '../types';
import type { TreeNode } from './treeUtils';

/** What /fetch_tree answers with `return_metadata: true`: the tree, or the tree and its metadata. */
export type ActTreeResponse = TreeNode[] | { articles?: TreeNode[]; metadata?: TreeMetadata };

/** One annex's worth of article titles, as served by /fetch_rubriche. */
export interface RubrichePart {
  name: string;
  keys: string[];
  rubriche: Record<string, string>;
  abrogati: string[];
}

export interface ActRubricheResponse {
  /** The act's title, made presentable by the server (`presentable_title`); '' or absent when there is none. */
  title?: string;
  rubriche?: Record<string, string>;
  abrogati?: string[];
  parts?: RubrichePart[];
}

// An act's structure and its article titles are the same for every reader of
// that act in a session, and each costs a call to the sources — in production a
// point of the user's scraping quota. A block that remounts (or React's double
// effect in development) asked again each time: four trees and four rubriche
// for one article. Session-only, like articleFetchCache: never persisted, never
// in the store; a failure is dropped so the next caller asks again.
const cache = new Map<string, Promise<unknown>>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const promise = load().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}

async function postJson<T>(path: string, body: unknown, failure: string): Promise<T> {
  const response = await legalFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${failure} (HTTP ${response.status})`);
  return (await response.json()) as T;
}

/** The article tree of an act, with its metadata (annexes, article numbers). */
export function fetchActTree(urn: string): Promise<ActTreeResponse> {
  return once(`tree ${urn}`, () =>
    postJson<ActTreeResponse>(
      '/fetch_tree',
      { urn, link: false, details: true, return_metadata: true },
      'Impossibile caricare la struttura',
    ),
  );
}

/** The article titles of an act, from its Akoma Ntoso export (slow when cold). */
export function fetchActRubriche(urn: string): Promise<ActRubricheResponse> {
  return once(`rubriche ${urn}`, () =>
    postJson<ActRubricheResponse>('/fetch_rubriche', { urn }, 'Rubriche non disponibili'),
  );
}

export function clearActStructureCache(): void {
  cache.clear();
}
