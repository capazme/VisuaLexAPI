import { describe, it, expect } from 'vitest';
import { confirmSourceEntityText, formatRetrievedUrn } from '../format';

describe('confirmSourceEntityText (B3 — human name for "ricorda nel grafo")', () => {
  it('prefers the underlying source_url for a provisional live: node', () => {
    expect(
      confirmSourceEntityText({
        urn: 'live:abc',
        provenance: 'live_unconfirmed',
        node_id: 'live:abc',
        source_url: 'https://normattiva.it/...~art467',
      }),
    ).toBe('art. 467');
  });

  it('falls back to a human placeholder for a bare live: node with no source_url', () => {
    const name = confirmSourceEntityText({
      urn: 'live:abc',
      provenance: 'live_unconfirmed',
      node_id: 'live:abc',
    });
    expect(name).toBe('Fonte provvisoria');
    // The critical invariant: never the raw provisional id.
    expect(name.startsWith('live:')).toBe(false);
  });

  it('formats a canonical article URN directly', () => {
    expect(confirmSourceEntityText({ urn: 'urn:nir:..~art1453', provenance: 'seed' })).toBe('art. 1453');
  });

  it('never returns a string starting with the live: node id', () => {
    for (const source_url of [undefined, 'https://normattiva.it/...~art12-bis']) {
      const name = confirmSourceEntityText({
        urn: 'live:deadbeef',
        provenance: 'live_unconfirmed',
        node_id: 'live:deadbeef',
        source_url,
      });
      expect(name.startsWith('live:')).toBe(false);
    }
  });
});

describe('formatRetrievedUrn', () => {
  it('renders a provisional live: node as a placeholder', () => {
    expect(formatRetrievedUrn('live:abc')).toBe('Fonte provvisoria');
  });
});
