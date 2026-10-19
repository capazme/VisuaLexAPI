/**
 * Local graph-slice snapshot I/O (Slice 2c #7). The server does NOT host
 * per-user graphs (resource cost); instead the user can export a slice of the
 * central graph they're viewing to a local JSON and reload it for read-only
 * viewing. Pure functions here; the DOM download/upload wiring lives in the page.
 */

export interface GraphSliceSnapshot {
  version: 1;
  exportedAt: string;
  rootUrn?: string;
  nodes: Array<{ id: string; label?: string; type?: string; urn?: string | null }>;
  edges: Array<{ id: string; source: string; target: string; type?: string }>;
}

export function buildSnapshot(
  nodes: GraphSliceSnapshot['nodes'],
  edges: GraphSliceSnapshot['edges'],
  rootUrn?: string,
): GraphSliceSnapshot {
  return { version: 1, exportedAt: new Date().toISOString(), rootUrn, nodes, edges };
}

export class SnapshotParseError extends Error {}

/** Parse + validate a snapshot file's text. Throws SnapshotParseError on bad input. */
export function parseSnapshot(text: string): GraphSliceSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotParseError('Il file non è un JSON valido.');
  }
  if (!raw || typeof raw !== 'object') {
    throw new SnapshotParseError('Snapshot non valido.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new SnapshotParseError('Versione dello snapshot non supportata.');
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new SnapshotParseError('Snapshot privo di nodi/archi.');
  }
  return {
    version: 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    rootUrn: typeof obj.rootUrn === 'string' ? obj.rootUrn : undefined,
    nodes: obj.nodes as GraphSliceSnapshot['nodes'],
    edges: obj.edges as GraphSliceSnapshot['edges'],
  };
}

/** Trigger a browser download of the snapshot as a .json file. */
export function downloadSnapshot(snapshot: GraphSliceSnapshot, filename = 'merlt-slice.json'): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
