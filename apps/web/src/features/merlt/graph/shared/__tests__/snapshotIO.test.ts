import { describe, it, expect } from 'vitest';
import { buildSnapshot, parseSnapshot, SnapshotParseError } from '../snapshotIO';

describe('snapshotIO', () => {
  it('round-trips build → stringify → parse', () => {
    const snap = buildSnapshot(
      [{ id: 'n1', label: 'Art. 2043', type: 'Norma', urn: 'urn:x' }],
      [{ id: 'e1', source: 'n1', target: 'n2', type: 'ESPRIME' }],
      'urn:x',
    );
    const parsed = parseSnapshot(JSON.stringify(snap));
    expect(parsed.nodes).toEqual(snap.nodes);
    expect(parsed.edges).toEqual(snap.edges);
    expect(parsed.rootUrn).toBe('urn:x');
    expect(parsed.version).toBe(1);
  });

  it('rejects non-JSON', () => {
    expect(() => parseSnapshot('not json')).toThrow(SnapshotParseError);
  });

  it('rejects an unsupported version', () => {
    expect(() => parseSnapshot(JSON.stringify({ version: 2, nodes: [], edges: [] }))).toThrow(
      SnapshotParseError,
    );
  });

  it('rejects a snapshot missing nodes/edges arrays', () => {
    expect(() => parseSnapshot(JSON.stringify({ version: 1, nodes: 'x' }))).toThrow(
      SnapshotParseError,
    );
  });
});
